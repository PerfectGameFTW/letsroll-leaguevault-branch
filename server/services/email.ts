import sgMail, { type MailDataRequired } from '@sendgrid/mail';
import sanitizeHtml from 'sanitize-html';
import { storage } from '../storage';
import { env, isDev } from '../config';
import { createLogger } from '../logger';
import { maskEmail } from '../utils/pii';
import { pickPasswordChangedLocale } from './email-i18n/password-changed';
import { pickAccountLockoutLocale } from './email-i18n/account-lockout';
import { captureEmail } from './_internal/email-outbox';

const log = createLogger("Email");

// ---------------------------------------------------------------------------
// SendGrid dispatch guard (task #593).
//
// Every outbound message in this file flows through `dispatchMail` instead of
// calling `sgMail.send` directly. The dispatcher checks recipient domains
// against the configured `BLOCK_EMAIL_DOMAINS` list (default: `vitest.local`)
// and refuses to hand the message to SendGrid when every recipient is on
// that list. This stops integration tests — which create real users at
// `@vitest.local` — from generating SendGrid bounces that count against our
// daily quota and damage sender reputation.
//
// Why a domain block instead of a global "skip in tests" flag?
//   - The full email pipeline (template lookup, variable substitution,
//     HTML sanitization, From/To assembly) still runs, so a bug in any
//     of those layers still surfaces in tests exactly as it does today.
//   - A render/sanitize error throws *before* the guard short-circuits,
//     so it bubbles up to the test as a failure rather than being swallowed.
//   - Tests that want to assert on a captured email can use the helpers in
//     `server/services/_internal/email-outbox.ts` (`getCapturedEmails`,
//     `clearCapturedEmails`) without needing per-test `vi.mock` of SendGrid.
//
// To add another blocked domain, set `BLOCK_EMAIL_DOMAINS` in the env to a
// comma-separated list (e.g. `BLOCK_EMAIL_DOMAINS=vitest.local,example.test`).
// To disable the guard entirely (NOT recommended in dev/CI), set it to "".
// ---------------------------------------------------------------------------

type EmailAddress = string | { email: string; name?: string };
type Recipients = EmailAddress | EmailAddress[] | undefined;

function addressOf(entry: EmailAddress): string {
  return typeof entry === 'string' ? entry : entry.email;
}

function domainOf(entry: EmailAddress): string {
  const addr = addressOf(entry);
  const at = addr.lastIndexOf('@');
  return at < 0 ? '' : addr.slice(at + 1).toLowerCase();
}

interface PartitionResult {
  kept: EmailAddress[];
  dropped: EmailAddress[];
  droppedDomains: string[];
}

function partitionRecipients(field: Recipients, blocked: string[]): PartitionResult {
  if (field === undefined) return { kept: [], dropped: [], droppedDomains: [] };
  const list = Array.isArray(field) ? field : [field];
  const kept: EmailAddress[] = [];
  const dropped: EmailAddress[] = [];
  const droppedDomains: string[] = [];
  for (const entry of list) {
    const dom = domainOf(entry);
    if (dom && blocked.includes(dom)) {
      dropped.push(entry);
      if (!droppedDomains.includes(dom)) droppedDomains.push(dom);
    } else {
      kept.push(entry);
    }
  }
  return { kept, dropped, droppedDomains };
}

function rewriteRecipients(field: Recipients, kept: EmailAddress[]): Recipients {
  if (field === undefined) return undefined;
  if (kept.length === 0) return undefined;
  // Preserve the original shape: scalar in → scalar out (when only one
  // recipient remains AND the original was scalar), array in → array out.
  if (!Array.isArray(field) && kept.length === 1) return kept[0];
  return kept;
}

function describeSubject(msg: MailDataRequired): string {
  const s = msg.subject;
  return typeof s === 'string' ? s : '<no subject>';
}

async function dispatchMail(msg: MailDataRequired, isMultiple = false): Promise<void> {
  // `?? []` defends against test files that vi.mock('../../server/config')
  // and forget to surface the new field — those mocks pre-date task #593.
  const blocked = env.BLOCK_EMAIL_DOMAINS ?? [];
  if (blocked.length === 0) {
    // Guard fully disabled — go straight to SendGrid.
    await sgMail.send(msg, isMultiple);
    return;
  }

  const to = partitionRecipients(msg.to, blocked);
  const cc = partitionRecipients(msg.cc, blocked);
  const bcc = partitionRecipients(msg.bcc, blocked);

  const totalRecipients = to.kept.length + to.dropped.length
    + cc.kept.length + cc.dropped.length
    + bcc.kept.length + bcc.dropped.length;
  const totalKept = to.kept.length + cc.kept.length + bcc.kept.length;
  const allBlocked = totalRecipients > 0 && totalKept === 0;
  const someBlocked = to.dropped.length + cc.dropped.length + bcc.dropped.length > 0;

  if (allBlocked) {
    const droppedDomains = Array.from(
      new Set([...to.droppedDomains, ...cc.droppedDomains, ...bcc.droppedDomains]),
    );
    captureEmail({
      msg: { ...msg },
      blockedDomains: droppedDomains,
      capturedAt: new Date(),
    });
    const sample = [...to.dropped, ...cc.dropped, ...bcc.dropped]
      .map((r) => maskEmail(addressOf(r)))
      .slice(0, 5)
      .join(', ');
    log.info(
      `Blocked SendGrid send to test-only domain(s) [${droppedDomains.join(', ')}] — captured in outbox. Subject: "${describeSubject(msg)}", recipients: ${sample}`,
    );
    return;
  }

  if (someBlocked) {
    // Mixed recipient list. Rewrite each list to keep only the safe
    // recipients and forward the trimmed message. Never silently drop
    // a legitimate recipient — only the blocked ones go away.
    const rewritten: MailDataRequired = { ...msg };
    if (msg.to !== undefined) rewritten.to = rewriteRecipients(msg.to, to.kept);
    if (msg.cc !== undefined) rewritten.cc = rewriteRecipients(msg.cc, cc.kept);
    if (msg.bcc !== undefined) rewritten.bcc = rewriteRecipients(msg.bcc, bcc.kept);
    const droppedDomains = Array.from(
      new Set([...to.droppedDomains, ...cc.droppedDomains, ...bcc.droppedDomains]),
    );
    log.info(
      `Stripped blocked recipient(s) on domain(s) [${droppedDomains.join(', ')}] from SendGrid message. Subject: "${describeSubject(msg)}"`,
    );
    await sgMail.send(rewritten, isMultiple);
    return;
  }

  await sgMail.send(msg, isMultiple);
}

type SendgridLikeError = {
  response?: { body?: unknown };
  message?: string;
};

function describeMailError(error: unknown): unknown {
  if (error && typeof error === 'object') {
    const e = error as SendgridLikeError;
    if (e.response?.body !== undefined) return e.response.body;
    if (typeof e.message === 'string') return e.message;
  }
  return error;
}

const SENDGRID_API_KEY = env.SENDGRID_API_KEY;
// safe: APP_DOMAIN is normalised to lowercase at parse-time (task #335).
// The domain part of an email address is case-insensitive per RFC 5321
// §2.4, but we still want a canonical lowercase From: address so SPF /
// DKIM logs and bounce records read uniformly.
const FROM_EMAIL = `noreply@${env.APP_DOMAIN}`;
const FROM_NAME = 'LeagueVault';

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
  log.info('SendGrid initialized');
}

export function getBaseUrl(
  orgOrSlug?: string | { subdomain?: string | null; slug?: string | null } | null,
): string {
  if (isDev) {
    if (env.REPLIT_DOMAINS) {
      const domains = env.REPLIT_DOMAINS.split(',');
      return `https://${domains[0]}`;
    }
    if (env.REPL_SLUG && env.REPL_OWNER) {
      return `https://${env.REPL_SLUG}.${env.REPL_OWNER}.repl.co`;
    }
  }
  // Prefer the org's `subdomain` field (the actual DNS host) over `slug`
  // (an internal identifier that may contain hyphens not present in DNS).
  // Falls back to slug for legacy orgs that haven't been assigned a
  // subdomain yet.
  let host: string | null | undefined;
  if (typeof orgOrSlug === 'string') {
    host = orgOrSlug;
  } else if (orgOrSlug) {
    host = orgOrSlug.subdomain || orgOrSlug.slug || null;
  }
  // safe: APP_DOMAIN is normalised to lowercase at parse-time (task #335).
  // Hostnames in URLs are case-insensitive but we want a canonical
  // lowercase URL in outgoing emails so links don't look mangled.
  if (host) {
    return `https://${host}.${env.APP_DOMAIN}`;
  }
  return `https://${env.APP_DOMAIN}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? escapeHtml(variables[key]) : match;
  });
}

function replaceVariablesPlainText(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}

function sanitizeTemplateBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a',
      'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'span', 'div',
      'table', 'thead', 'tbody', 'tr', 'td', 'th',
      'img', 'hr', 'blockquote', 'pre', 'code',
    ],
    allowedAttributes: {
      'a': ['href', 'target', 'rel'],
      'img': ['src', 'alt', 'width', 'height'],
      'td': ['align', 'valign', 'width', 'style'],
      'th': ['align', 'valign', 'width', 'style'],
      'table': ['width', 'cellpadding', 'cellspacing', 'border', 'style'],
      'tr': ['style'],
      'div': ['style'],
      'span': ['style'],
      'p': ['style'],
      'h1': ['style'],
      'h2': ['style'],
      'h3': ['style'],
      'h4': ['style'],
      'h5': ['style'],
      'h6': ['style'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
  });
}

export function getOrgLogoUrl(org: { slug: string } | null | undefined): string {
  if (!org?.slug) return '';
  const baseUrl = getBaseUrl();
  return `${baseUrl}/api/organizations/slug/${org.slug}/logo`;
}

function convertLinksToButtons(html: string): string {
  return html.replace(
    /^\s*(https?:\/\/[^\s<]+)\s*$/gm,
    (_match, url) => {
      const safeUrl = escapeHtml(url);
      let label = 'Click Here';
      if (url.includes('/set-password')) label = 'Set Up Your Password';
      else if (url.includes('/bowler-dashboard') || url.includes('/dashboard')) label = 'Go to Dashboard';
      else if (url.includes('/login')) label = 'Log In';
      else if (url.includes('/claim')) label = 'Claim Your Profile';

      return `<div style="margin: 20px 0;"><a href="${safeUrl}" style="display: inline-block; background-color: #1a1a2e; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold;">${label}</a></div>`;
    }
  );
}

function wrapInHtmlLayout(body: string, variables: Record<string, string>): string {
  const styledBody = convertLinksToButtons(body);

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      
      <div style="font-size: 16px; color: #333; white-space: pre-line;">
${styledBody}
      </div>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
      
      <p style="font-size: 12px; color: #999; text-align: center;">
        Powered by LeagueVault
      </p>
    </div>
  `;
}

export async function sendTemplatedEmail(
  slug: string,
  toEmail: string,
  variables: Record<string, string>
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error('Cannot send email — SENDGRID_API_KEY not configured');
    return false;
  }

  try {
    const template = await storage.getEmailTemplateBySlug(slug);
    if (!template || !template.active) {
      log.info(`Template '${slug}' not found or inactive, skipping`);
      return false;
    }

    const subject = replaceVariablesPlainText(template.subject, variables);
    const body = replaceVariables(template.body, variables);
    const html = wrapInHtmlLayout(sanitizeTemplateBody(body), variables);

    const msg = {
      to: toEmail,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      html,
      trackingSettings: {
        clickTracking: { enable: false, enableText: false },
      },
    };

    await dispatchMail(msg);
    log.info(`Templated email '${slug}' sent to:`, isDev ? toEmail : maskEmail(toEmail));
    return true;
  } catch (error) {
    log.error(`Failed to send templated email '${slug}':`, describeMailError(error));
    return false;
  }
}

export async function sendInviteEmail(
  toEmail: string,
  userName: string,
  inviteToken: string,
  organizationName?: string,
  organizationId?: number,
  orgSlug?: string | null
): Promise<boolean> {
  const baseUrl = getBaseUrl(orgSlug);
  const setupUrl = `${baseUrl}/set-password?token=${inviteToken}`;

  const variables: Record<string, string> = {
    bowler_name: userName,
    invite_link: setupUrl,
  };
  if (organizationName) {
    variables.organization_name = organizationName;
  }
  if (organizationId) {
    const orgForLogo = await storage.getOrganization(
      typeof organizationId === 'number' ? organizationId : parseInt(String(organizationId), 10),
    );
    if (orgForLogo) {
      variables.organization_logo_url = getOrgLogoUrl(orgForLogo);
    }
  }

  const sent = await sendTemplatedEmail('bulk_invite', toEmail, variables);
  if (sent) return true;

  if (!SENDGRID_API_KEY) {
    log.error('Cannot send invite — SENDGRID_API_KEY not configured');
    return false;
  }

  const msg = {
    to: toEmail,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: 'Welcome to LeagueVault — Set Up Your Account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #1a1a2e; margin: 0;">LeagueVault</h1>
        </div>
        
        <p style="font-size: 16px; color: #333;">Hi ${userName},</p>
        
        <p style="font-size: 16px; color: #333;">
          You've been invited to join ${organizationName ? `<strong>${organizationName}</strong> on ` : ''}LeagueVault. 
          To get started, please set up your password by clicking the button below.
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${setupUrl}" 
             style="background-color: #1a1a2e; color: #ffffff; padding: 14px 28px; 
                    text-decoration: none; border-radius: 6px; font-size: 16px; 
                    display: inline-block; font-weight: bold;">
            Set Up Your Password
          </a>
        </div>
        
        <p style="font-size: 14px; color: #666;">
          If the button doesn't work, copy and paste this link into your browser:
        </p>
        <p style="font-size: 14px; color: #666; word-break: break-all;">
          <a href="${setupUrl}" style="color: #1a1a2e;">${setupUrl}</a>
        </p>
        
        <p style="font-size: 14px; color: #666;">
          This link will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
        </p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        
        <p style="font-size: 12px; color: #999; text-align: center;">
          Powered by LeagueVault
        </p>
      </div>
    `,
    trackingSettings: {
      clickTracking: { enable: false, enableText: false },
    },
  };

  try {
    await dispatchMail(msg);
    log.info('Invite email sent to:', isDev ? toEmail : maskEmail(toEmail));
    return true;
  } catch (error) {
    log.error('Failed to send invite email:', describeMailError(error));
    return false;
  }
}

export async function sendTestEmail(
  template: { subject: string; body: string; slug: string },
  toEmail: string,
  organization?: { id: number; name: string; slug: string; logo?: string | null } | null
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error('Cannot send test email — SENDGRID_API_KEY not configured');
    return false;
  }

  const sampleVariables: Record<string, string> = {
    bowler_name: 'John Smith',
    admin_name: 'Jane Admin',
    user_name: 'Alex User',
    organization_name: organization?.name || 'Sample Bowling Center',
    organization_logo_url: organization?.logo ? getOrgLogoUrl(organization) : '',
    league_name: 'Wednesday Night Mixed',
    invite_link: getBaseUrl() + '/set-password?token=sample-test-token',
    login_link: getBaseUrl() + '/login',
    dashboard_link: getBaseUrl() + '/bowler-dashboard',
  };

  const subject = `[TEST] ${replaceVariablesPlainText(template.subject, sampleVariables)}`;
  const body = replaceVariables(template.body, sampleVariables);
  const html = wrapInHtmlLayout(sanitizeTemplateBody(body), sampleVariables);

  try {
    await dispatchMail({
      to: toEmail,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      html,
      trackingSettings: {
        clickTracking: { enable: false, enableText: false },
      },
    });
    log.info(`Test email for '${template.slug}' sent to:`, isDev ? toEmail : maskEmail(toEmail));
    return true;
  } catch (error) {
    log.error(`Failed to send test email:`, describeMailError(error));
    return false;
  }
}

export async function sendPasswordResetFallbackEmail(
  toEmail: string,
  userName: string,
  resetToken: string,
  orgSlug?: string | null
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error('Cannot send password reset email — SENDGRID_API_KEY not configured');
    return false;
  }

  const baseUrl = getBaseUrl(orgSlug);
  const resetUrl = `${baseUrl}/set-password?token=${resetToken}`;

  const msg = {
    to: toEmail,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: 'Reset Your Password — LeagueVault',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #1a1a2e; margin: 0;">LeagueVault</h1>
        </div>
        <p style="font-size: 16px; color: #333;">Hi ${userName},</p>
        <p style="font-size: 16px; color: #333;">
          We received a request to reset your password. Click the button below to choose a new password.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}"
             style="background-color: #1a1a2e; color: #ffffff; padding: 14px 28px;
                    text-decoration: none; border-radius: 6px; font-size: 16px;
                    display: inline-block; font-weight: bold;">
            Reset Password
          </a>
        </div>
        <p style="font-size: 14px; color: #666;">
          If the button doesn't work, copy and paste this link into your browser:
        </p>
        <p style="font-size: 14px; color: #666; word-break: break-all;">
          <a href="${resetUrl}">${resetUrl}</a>
        </p>
        <p style="font-size: 14px; color: #666;">
          This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">
          &copy; LeagueVault. All rights reserved.
        </p>
      </div>
    `,
    trackingSettings: {
      clickTracking: { enable: false, enableText: false },
    },
  };

  try {
    await dispatchMail(msg);
    log.info('Password reset email sent to:', isDev ? toEmail : maskEmail(toEmail));
    return true;
  } catch (error) {
    log.error('Failed to send password reset email:', describeMailError(error));
    return false;
  }
}

export async function sendDeletionRequestNotification(
  toEmails: string[],
  request: { id: number; email: string; reason?: string | null; createdAt: string },
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error('Cannot send deletion request notification — SENDGRID_API_KEY not configured');
    return false;
  }
  if (toEmails.length === 0) return false;

  const baseUrl = getBaseUrl();
  const reviewUrl = `${baseUrl}/admin/deletion-requests`;
  const safeEmail = escapeHtml(request.email);
  const safeReason = escapeHtml(request.reason || 'No reason provided');
  const safeCreated = escapeHtml(request.createdAt);

  const msg = {
    to: toEmails,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `[LeagueVault] New account deletion request from ${request.email}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e; margin-top: 0;">New account deletion request</h2>
        <p style="font-size: 14px; color: #333;">A user has requested account deletion.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #333;">
          <tr><td style="padding: 6px 0; color: #666; width: 120px;">Email</td><td style="padding: 6px 0;"><strong>${safeEmail}</strong></td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Submitted</td><td style="padding: 6px 0;">${safeCreated}</td></tr>
          <tr><td style="padding: 6px 0; color: #666; vertical-align: top;">Reason</td><td style="padding: 6px 0; white-space: pre-wrap;">${safeReason}</td></tr>
        </table>
        <div style="margin: 24px 0;">
          <a href="${escapeHtml(reviewUrl)}" style="background-color: #1a1a2e; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold; display: inline-block;">Review request</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Powered by LeagueVault</p>
      </div>
    `,
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  };

  try {
    await dispatchMail(msg, true);
    log.info(`Deletion request notification sent to ${toEmails.length} admin(s) for request ${request.id}`);
    return true;
  } catch (error) {
    log.error('Failed to send deletion request notification:', describeMailError(error));
    return false;
  }
}

export async function sendApplePayRecoveryAlert(
  toEmails: string[],
  details: {
    itemCount: number;
    affectedJobIds: number[];
    itemIds: number[];
    suppressedSinceLastAlert: number;
  },
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error('Cannot send Apple Pay recovery alert — SENDGRID_API_KEY not configured');
    return false;
  }
  if (toEmails.length === 0) return false;

  const baseUrl = getBaseUrl();
  const reviewUrl = `${baseUrl}/admin/apple-pay-jobs`;
  const safeJobIds = escapeHtml(details.affectedJobIds.join(', '));
  const previewItemIds = details.itemIds.slice(0, 25);
  const safeItemIds = escapeHtml(
    previewItemIds.join(', ') +
      (details.itemIds.length > previewItemIds.length
        ? ` (+${details.itemIds.length - previewItemIds.length} more)`
        : ''),
  );
  const suppressedLine =
    details.suppressedSinceLastAlert > 0
      ? `<p style="font-size: 13px; color: #b45309;">${details.suppressedSinceLastAlert} additional recovery event(s) were suppressed by rate-limiting since the last alert.</p>`
      : '';

  const msg = {
    to: toEmails,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `[LeagueVault] Apple Pay worker recovered ${details.itemCount} stalled item(s)`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e; margin-top: 0;">Apple Pay items revived after stall</h2>
        <p style="font-size: 14px; color: #333;">
          The Apple Pay worker just revived <strong>${details.itemCount}</strong> item(s)
          whose pre-call lease had expired. This usually means the previous worker
          crashed mid-call or the payment provider hung — please investigate.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #333;">
          <tr><td style="padding: 6px 0; color: #666; width: 140px;">Items recovered</td><td style="padding: 6px 0;"><strong>${details.itemCount}</strong></td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Affected job IDs</td><td style="padding: 6px 0;">${safeJobIds}</td></tr>
          <tr><td style="padding: 6px 0; color: #666; vertical-align: top;">Item IDs</td><td style="padding: 6px 0; word-break: break-word;">${safeItemIds}</td></tr>
        </table>
        ${suppressedLine}
        <div style="margin: 24px 0;">
          <a href="${escapeHtml(reviewUrl)}" style="background-color: #1a1a2e; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold; display: inline-block;">Open Apple Pay Jobs</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Powered by LeagueVault</p>
      </div>
    `,
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  };

  try {
    await dispatchMail(msg, true);
    log.info(
      `Apple Pay recovery alert sent to ${toEmails.length} admin(s) for ${details.itemCount} item(s)`,
    );
    return true;
  } catch (error) {
    log.error('Failed to send Apple Pay recovery alert:', describeMailError(error));
    return false;
  }
}

/**
 * Page support when an organization's Square catalog hits the
 * pagination safety cap (Task #644). One email per affected
 * (organization, location) per rate-limit window — see
 * `SquareCatalogCapAlerter` for the dedup contract.
 */
export async function sendSquareCatalogCapAlert(
  toEmails: string[],
  details: {
    organizationId: number | null;
    locationId: number;
    reason: "max_items" | "max_pages";
    context: string;
    suppressedSinceLastAlert: number;
  },
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error("Cannot send Square catalog cap alert — SENDGRID_API_KEY not configured");
    return false;
  }
  if (toEmails.length === 0) return false;

  const baseUrl = getBaseUrl();
  const reviewUrl = `${baseUrl}/admin/locations/${details.locationId}`;
  const safeOrgId = escapeHtml(
    details.organizationId === null ? "(unknown)" : String(details.organizationId),
  );
  const safeLocationId = escapeHtml(String(details.locationId));
  const safeReason = escapeHtml(details.reason);
  const safeContext = escapeHtml(details.context);
  const suppressedLine =
    details.suppressedSinceLastAlert > 0
      ? `<p style="font-size: 13px; color: #b45309;">${details.suppressedSinceLastAlert} additional cap event(s) for this location were suppressed by rate-limiting since the last alert.</p>`
      : "";

  const msg = {
    to: toEmails,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `[LeagueVault] Square catalog hit pagination cap (org ${safeOrgId}, location ${safeLocationId})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e; margin-top: 0;">Square catalog too large to fully load</h2>
        <p style="font-size: 14px; color: #333;">
          A request to list this organization's Square catalog tripped our
          pagination safety cap. The admin saw a "catalog truncated" banner;
          the visible list is incomplete. Reach out to the organization to
          either prune their catalog or scope by category before we lose
          more items silently.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #333;">
          <tr><td style="padding: 6px 0; color: #666; width: 160px;">Organization ID</td><td style="padding: 6px 0;"><strong>${safeOrgId}</strong></td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Location ID</td><td style="padding: 6px 0;"><strong>${safeLocationId}</strong></td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Cap that fired</td><td style="padding: 6px 0;">${safeReason}</td></tr>
          <tr><td style="padding: 6px 0; color: #666; vertical-align: top;">Call site</td><td style="padding: 6px 0; word-break: break-word;">${safeContext}</td></tr>
        </table>
        ${suppressedLine}
        <div style="margin: 24px 0;">
          <a href="${escapeHtml(reviewUrl)}" style="background-color: #1a1a2e; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold; display: inline-block;">Open Location</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Powered by LeagueVault</p>
      </div>
    `,
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  };

  try {
    await dispatchMail(msg, true);
    log.info(
      `Square catalog cap alert sent to ${toEmails.length} admin(s) for location ${details.locationId}`,
    );
    return true;
  } catch (error) {
    log.error("Failed to send Square catalog cap alert:", describeMailError(error));
    return false;
  }
}

/**
 * Resend a Square hosted-receipt link. Tries the DB-driven
 * 'payment_receipt_resend' template first, falling back to the
 * inline HTML below on fresh installs.
 */
export async function sendReceiptResendEmail(
  toEmail: string,
  context: {
    receiptUrl: string;
    receiptNumber?: string | null;
    amountCents: number;
    leagueName?: string | null;
    organizationName?: string | null;
  },
): Promise<boolean> {
  const dollars = (context.amountCents / 100).toFixed(2);

  const templateVars: Record<string, string> = {
    receipt_url: context.receiptUrl,
    receipt_number: context.receiptNumber || '',
    amount: `$${dollars}`,
    league_name: context.leagueName || 'your league',
    organization_name: context.organizationName || 'LeagueVault',
  };
  const sentViaTemplate = await sendTemplatedEmail(
    'payment_receipt_resend',
    toEmail,
    templateVars,
  );
  if (sentViaTemplate) return true;

  if (!SENDGRID_API_KEY) {
    log.error('Cannot send receipt resend — SENDGRID_API_KEY not configured');
    return false;
  }

  const safeUrl = escapeHtml(context.receiptUrl);
  const safeNumber = escapeHtml(context.receiptNumber || '');
  const safeLeague = escapeHtml(context.leagueName || 'your league');
  const safeOrg = escapeHtml(context.organizationName || 'LeagueVault');

  const msg = {
    to: toEmail,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `Your receipt for ${context.organizationName || 'LeagueVault'}${context.receiptNumber ? ` (#${context.receiptNumber})` : ''}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <p style="font-size: 16px; color: #333;">Hi,</p>
        <p style="font-size: 16px; color: #333;">
          Here is your receipt for the $${dollars} payment to
          <strong>${safeOrg}</strong> for ${safeLeague}${safeNumber ? ` (receipt #${safeNumber})` : ''}.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${safeUrl}"
             style="background-color: #1a1a2e; color: #ffffff; padding: 14px 28px;
                    text-decoration: none; border-radius: 6px; font-size: 16px;
                    display: inline-block; font-weight: bold;">
            View Receipt
          </a>
        </div>
        <p style="font-size: 14px; color: #666;">
          If the button doesn't work, copy and paste this link into your browser:
        </p>
        <p style="font-size: 14px; color: #666; word-break: break-all;">
          <a href="${safeUrl}">${safeUrl}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Powered by LeagueVault</p>
      </div>
    `,
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  };

  try {
    await dispatchMail(msg);
    log.info('Receipt resend sent to:', isDev ? toEmail : maskEmail(toEmail));
    return true;
  } catch (error) {
    log.error('Failed to send receipt resend:', describeMailError(error));
    return false;
  }
}

export async function sendEmailChangeConfirmation(
  toEmail: string,
  userName: string,
  confirmUrl: string,
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error('Cannot send email-change confirmation — SENDGRID_API_KEY not configured');
    return false;
  }

  const safeName = escapeHtml(userName || 'there');
  const safeUrl = escapeHtml(confirmUrl);

  const msg = {
    to: toEmail,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: 'Confirm your new LeagueVault email address',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <p style="font-size: 16px; color: #333;">Hi ${safeName},</p>
        <p style="font-size: 16px; color: #333;">
          We received a request to use this address as the login email for your
          LeagueVault account. Please confirm by clicking the button below.
          Your login email will <strong>not</strong> change until you confirm.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${safeUrl}"
             style="background-color: #1a1a2e; color: #ffffff; padding: 14px 28px;
                    text-decoration: none; border-radius: 6px; font-size: 16px;
                    display: inline-block; font-weight: bold;">
            Confirm Email Change
          </a>
        </div>
        <p style="font-size: 14px; color: #666;">
          If the button doesn't work, copy and paste this link into your browser:
        </p>
        <p style="font-size: 14px; color: #666; word-break: break-all;">
          <a href="${safeUrl}">${safeUrl}</a>
        </p>
        <p style="font-size: 14px; color: #666;">
          This link expires in 24 hours and can be used only once. If you didn't
          request this change, you can safely ignore this email.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Powered by LeagueVault</p>
      </div>
    `,
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  };

  try {
    await dispatchMail(msg);
    log.info('Email-change confirmation sent to:', isDev ? toEmail : maskEmail(toEmail));
    return true;
  } catch (error) {
    log.error('Failed to send email-change confirmation:', describeMailError(error));
    return false;
  }
}

export async function sendEmailChangeNotification(
  toEmail: string,
  userName: string,
  newEmailMasked: string,
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error('Cannot send email-change notification — SENDGRID_API_KEY not configured');
    return false;
  }

  const safeName = escapeHtml(userName || 'there');
  const safeMasked = escapeHtml(newEmailMasked);
  const supportUrl = `${getBaseUrl()}/support`;

  const msg = {
    to: toEmail,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: 'Email change requested on your LeagueVault account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <p style="font-size: 16px; color: #333;">Hi ${safeName},</p>
        <p style="font-size: 16px; color: #333;">
          Someone — most likely you — requested to change the login email on
          your LeagueVault account to <strong>${safeMasked}</strong>.
        </p>
        <p style="font-size: 16px; color: #333;">
          Your login email has <strong>not</strong> changed yet. It will only
          change once the new address confirms ownership via the link sent to
          them.
        </p>
        <p style="font-size: 16px; color: #333;">
          <strong>If this wasn't you</strong>, please change your password
          immediately and contact support — someone may have access to your
          account.
        </p>
        <p style="font-size: 14px; color: #666; word-break: break-all;">
          <a href="${escapeHtml(supportUrl)}">${escapeHtml(supportUrl)}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Powered by LeagueVault</p>
      </div>
    `,
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  };

  try {
    await dispatchMail(msg);
    log.info('Email-change notification sent to:', isDev ? toEmail : maskEmail(toEmail));
    return true;
  } catch (error) {
    log.error('Failed to send email-change notification:', describeMailError(error));
    return false;
  }
}

/**
 * Best-effort security notification sent after a successful change to
 * the user's password. Mirrors the industry-standard "your password
 * was just changed" email (Google, GitHub, Stripe). The change is
 * already committed by the time we get here — a SendGrid failure
 * MUST NOT roll the password back, so callers should ignore the
 * boolean return value beyond logging.
 *
 * Includes a coarse fingerprint of the request that triggered the
 * change (timestamp, approximate IP, truncated user-agent) so a
 * recipient who DIDN'T initiate the change has enough context to
 * recognize it as suspicious without leaking precise location data.
 */
export async function sendPasswordChangedNotification(
  toEmail: string,
  userName: string,
  context: {
    changedAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
    /**
     * ISO 639-1 two-letter locale (e.g. 'en', 'es') taken from the
     * recipient's `users.preferred_language`. Unknown / null values
     * fall back to English (task #410). Region tags like `es-MX`
     * collapse to their base language inside the resolver.
     */
    locale?: string | null;
    /**
     * Who initiated the password change (task #416). When `'admin'`,
     * the email body includes an extra translator-supplied line
     * stating that the change was performed by an administrator on
     * the recipient's account, so the user can immediately
     * distinguish a legitimate delegated rotation from an attacker
     * who happens to have access to their account. Defaults to
     * `'self'` for backwards compatibility — the existing
     * change-password and set-password call sites stay unchanged.
     */
    actor?: 'self' | 'admin';
  },
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error('Cannot send password-changed notification — SENDGRID_API_KEY not configured');
    return false;
  }

  const { code: localeCode, strings } = pickPasswordChangedLocale(context.locale);

  const safeName = escapeHtml(userName || 'there');
  // Format the timestamp in UTC with the offset spelled out so the
  // recipient (who could be in any timezone) can sanity-check it.
  const safeChangedAt = escapeHtml(context.changedAt.toUTCString());
  const safeIp = escapeHtml(context.ipAddress?.trim() || strings.unknown);
  // Truncate the UA to keep the email body bounded; full UAs can be
  // hundreds of characters and a coarse hint is all we need for the
  // "was this you?" sniff test.
  const rawUa = (context.userAgent ?? '').trim();
  const safeUa = escapeHtml(rawUa ? (rawUa.length > 120 ? `${rawUa.slice(0, 120)}…` : rawUa) : strings.unknown);
  const supportUrl = `${getBaseUrl()}/support`;
  // Greeting / intro are translator-supplied plain text, so escape
  // them ONCE at splice time. We feed the raw (un-escaped) display
  // name into `strings.greeting` and then escape the resulting
  // sentence — escaping `safeName` first AND then escaping the
  // whole greeting would double-encode (`A&B` → `A&amp;amp;B`).
  // ifThisWasYou / ifThisWasntYou intentionally contain a small
  // <strong> wrapper from the translator and are spliced raw —
  // they MUST NOT include user-controlled data.
  const displayName = userName || 'there';
  const safeGreeting = escapeHtml(strings.greeting(displayName));
  const safeIntro = escapeHtml(strings.intro);
  // Only render the admin-actor line when the caller asked for it
  // (task #416). Defaults to self-service so existing call sites at
  // server/routes/account.ts and server/routes/auth.ts keep their
  // pre-#416 wording verbatim — this prevents the admin sentence
  // from leaking into a normal user-driven password change just
  // because someone forgot to pass the actor flag.
  const adminLineHtml =
    context.actor === 'admin'
      ? `<p style="font-size: 16px; color: #333;">${escapeHtml(strings.performedByAdmin)}</p>`
      : '';

  const msg = {
    to: toEmail,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: strings.subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;" lang="${localeCode}">
        <p style="font-size: 16px; color: #333;">${safeGreeting}</p>
        <p style="font-size: 16px; color: #333;">${safeIntro}</p>
        ${adminLineHtml}
        <table style="font-size: 14px; color: #555; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #888;">${escapeHtml(strings.whenLabel)}</td>
            <td style="padding: 4px 0;">${safeChangedAt}</td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #888;">${escapeHtml(strings.fromIpLabel)}</td>
            <td style="padding: 4px 0;">${safeIp}</td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #888;">${escapeHtml(strings.browserLabel)}</td>
            <td style="padding: 4px 0;">${safeUa}</td>
          </tr>
        </table>
        <p style="font-size: 16px; color: #333;">${strings.ifThisWasYou}</p>
        <p style="font-size: 16px; color: #333;">${strings.ifThisWasntYou}</p>
        <p style="font-size: 14px; color: #666; word-break: break-all;">
          <a href="${escapeHtml(supportUrl)}">${escapeHtml(supportUrl)}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">${escapeHtml(strings.footer)}</p>
      </div>
    `,
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  };

  try {
    await dispatchMail(msg);
    log.info('Password-changed notification sent to:', isDev ? toEmail : maskEmail(toEmail), { locale: localeCode });
    return true;
  } catch (error) {
    log.error('Failed to send password-changed notification:', describeMailError(error));
    return false;
  }
}

/**
 * Confirmation email sent to the original requester after an admin
 * runs the automated account-data deletion. Best-effort: callers
 * should NOT roll back the deletion if this returns false.
 */
export async function sendAccountDeletionConfirmation(
  toEmail: string,
  details: {
    bowlersAnonymized: number;
    userAccountDeleted: boolean;
    paymentProviderRecordsDeleted: number;
    emailChangeRequestsDeleted: number;
    executedAt: string;
  },
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error('Cannot send account-deletion confirmation — SENDGRID_API_KEY not configured');
    return false;
  }

  const safeEmail = escapeHtml(toEmail);
  const safeExecutedAt = escapeHtml(details.executedAt);
  const supportUrl = `${getBaseUrl()}/support`;

  // Build the "what we removed" list. The verb (anonymized vs deleted)
  // matters for GDPR/CCPA wording — bowler rows are anonymized so the
  // historical scores/payments stay correct, while the user account
  // and ancillary records are removed outright.
  const items: string[] = [];
  items.push(
    `<li><strong>${details.bowlersAnonymized}</strong> bowler record(s) anonymized — your name, email, and contact details were removed; historical scores and league memberships are kept without identifying information.</li>`,
  );
  if (details.userAccountDeleted) {
    items.push(`<li>Your LeagueVault login account was <strong>deleted</strong>.</li>`);
  } else {
    items.push(
      `<li>No LeagueVault login account was found for this email, so nothing was deleted at the account level.</li>`,
    );
  }
  items.push(
    `<li><strong>${details.paymentProviderRecordsDeleted}</strong> saved payment-method record(s) removed at the payment processor.</li>`,
  );
  items.push(
    `<li><strong>${details.emailChangeRequestsDeleted}</strong> pending email-change request(s) deleted.</li>`,
  );

  const msg = {
    to: toEmail,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: 'Your LeagueVault account data has been deleted',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <p style="font-size: 16px; color: #333;">Hello,</p>
        <p style="font-size: 16px; color: #333;">
          We're confirming that the account-deletion request you submitted for
          <strong>${safeEmail}</strong> has been processed on
          <strong>${safeExecutedAt}</strong>. Here's what was removed:
        </p>
        <ul style="font-size: 15px; color: #333; line-height: 1.5;">
          ${items.join('\n          ')}
        </ul>
        <p style="font-size: 14px; color: #555;">
          Some records that contain other people's data — such as team
          rosters or league prize-fund history — were preserved with all
          identifying information about you removed.
        </p>
        <p style="font-size: 14px; color: #555;">
          If you didn't request this, or you believe this happened in
          error, please contact support right away:
        </p>
        <p style="font-size: 14px; color: #555; word-break: break-all;">
          <a href="${escapeHtml(supportUrl)}">${escapeHtml(supportUrl)}</a>
        </p>
        <p style="font-size: 14px; color: #555;">Thanks for using LeagueVault.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Powered by LeagueVault</p>
      </div>
    `,
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  };

  try {
    await dispatchMail(msg);
    log.info('Account-deletion confirmation sent to:', isDev ? toEmail : maskEmail(toEmail));
    return true;
  } catch (error) {
    log.error(
      'Failed to send account-deletion confirmation:',
      describeMailError(error),
    );
    return false;
  }
}

/**
 * Task #357: alert email sent when an account is auto-locked after
 * repeated failed current-password attempts on /api/account/change-password.
 * Best-effort — caller should NOT roll back the lock if SendGrid throws.
 *
 * The body tells the user (a) why the lock fired, (b) the request that
 * triggered it (when, IP, browser), (c) when the lock lifts, and
 * (d) a CTA to the forgot-password flow so they can recover without
 * waiting out the lock or knowing their old password.
 */
export async function sendAccountLockoutAlert(
  toEmail: string,
  userName: string,
  context: {
    lockedAt: Date;
    unlocksAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
    /**
     * ISO 639-1 two-letter locale (e.g. 'en', 'es') taken from the
     * recipient's `users.preferred_language`. Unknown / null values
     * fall back to English. Region tags like `es-MX` collapse to
     * their base language inside the resolver.
     */
    locale?: string | null;
  },
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error('Cannot send account-lockout alert — SENDGRID_API_KEY not configured');
    return false;
  }

  const { code: localeCode, strings } = pickAccountLockoutLocale(context.locale);

  const safeLockedAt = escapeHtml(context.lockedAt.toUTCString());
  const safeUnlocksAt = escapeHtml(context.unlocksAt.toUTCString());
  const safeIp = escapeHtml(context.ipAddress?.trim() || strings.unknown);
  const rawUa = (context.userAgent ?? '').trim();
  const safeUa = escapeHtml(rawUa ? (rawUa.length > 120 ? `${rawUa.slice(0, 120)}…` : rawUa) : strings.unknown);
  const forgotUrl = `${getBaseUrl()}/forgot-password`;
  const supportUrl = `${getBaseUrl()}/support`;

  // Greeting / intro are translator-supplied plain text, escape ONCE
  // at splice time. ifThisWasYou / ifThisWasntYou contain a small
  // <strong> wrapper from the translator and are spliced raw — they
  // MUST NOT include user-controlled data.
  const displayName = userName || 'there';
  const safeGreeting = escapeHtml(strings.greeting(displayName));
  const safeIntro = escapeHtml(strings.intro);

  const msg = {
    to: toEmail,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: strings.subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;" lang="${localeCode}">
        <p style="font-size: 16px; color: #333;">${safeGreeting}</p>
        <p style="font-size: 16px; color: #333;">${safeIntro}</p>
        <table style="font-size: 14px; color: #555; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #888;">${escapeHtml(strings.whenLabel)}</td>
            <td style="padding: 4px 0;">${safeLockedAt}</td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #888;">${escapeHtml(strings.fromIpLabel)}</td>
            <td style="padding: 4px 0;">${safeIp}</td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #888;">${escapeHtml(strings.browserLabel)}</td>
            <td style="padding: 4px 0;">${safeUa}</td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #888;">${escapeHtml(strings.unlocksAtLabel)}</td>
            <td style="padding: 4px 0;">${safeUnlocksAt}</td>
          </tr>
        </table>
        <p style="font-size: 16px; color: #333;">${strings.ifThisWasYou}</p>
        <p style="font-size: 16px; color: #333;">${strings.ifThisWasntYou}</p>
        <div style="margin: 20px 0;">
          <a href="${escapeHtml(forgotUrl)}" style="display: inline-block; background-color: #1a1a2e; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold;">${escapeHtml(strings.resetCta)}</a>
        </div>
        <p style="font-size: 14px; color: #666; word-break: break-all;">
          <a href="${escapeHtml(supportUrl)}">${escapeHtml(supportUrl)}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">${escapeHtml(strings.footer)}</p>
      </div>
    `,
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  };

  try {
    await dispatchMail(msg);
    log.info('Account-lockout alert sent to:', isDev ? toEmail : maskEmail(toEmail), { locale: localeCode });
    return true;
  } catch (error) {
    log.error('Failed to send account-lockout alert:', describeMailError(error));
    return false;
  }
}

export async function resendInviteEmail(
  toEmail: string,
  userName: string,
  inviteToken: string,
  organizationName?: string,
  organizationId?: number,
  orgSlug?: string | null
): Promise<boolean> {
  return sendInviteEmail(toEmail, userName, inviteToken, organizationName, organizationId, orgSlug);
}
