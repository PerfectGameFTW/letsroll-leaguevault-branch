import sgMail from '@sendgrid/mail';
import sanitizeHtml from 'sanitize-html';
import { storage } from '../storage';
import { env, isDev } from '../config';
import { createLogger } from '../logger';
import { maskEmail } from '../utils/pii';

const log = createLogger("Email");

const SENDGRID_API_KEY = env.SENDGRID_API_KEY;
const FROM_EMAIL = 'noreply@leaguevault.app';
const FROM_NAME = 'LeagueVault';

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
  log.info('SendGrid initialized');
}

export function getBaseUrl(orgSlug?: string | null): string {
  if (isDev) {
    if (env.REPLIT_DOMAINS) {
      const domains = env.REPLIT_DOMAINS.split(',');
      return `https://${domains[0]}`;
    }
    if (env.REPL_SLUG && env.REPL_OWNER) {
      return `https://${env.REPL_SLUG}.${env.REPL_OWNER}.repl.co`;
    }
  }
  if (orgSlug) {
    return `https://${orgSlug}.leaguevault.app`;
  }
  return 'https://leaguevault.app';
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

export function getOrgLogoUrl(orgId: number | string): string {
  const baseUrl = getBaseUrl();
  return `${baseUrl}/api/organizations/${orgId}/logo`;
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

    await sgMail.send(msg);
    log.info(`Templated email '${slug}' sent to:`, isDev ? toEmail : maskEmail(toEmail));
    return true;
  } catch (error: any) {
    log.error(`Failed to send templated email '${slug}':`, error?.response?.body || error.message);
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
    variables.organization_logo_url = getOrgLogoUrl(organizationId);
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
    await sgMail.send(msg);
    log.info('Invite email sent to:', isDev ? toEmail : maskEmail(toEmail));
    return true;
  } catch (error: any) {
    log.error('Failed to send invite email:', error?.response?.body || error.message);
    return false;
  }
}

export async function sendTestEmail(
  template: { subject: string; body: string; slug: string },
  toEmail: string,
  organization?: { id: number; name: string; logo?: string | null } | null
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
    organization_logo_url: organization?.logo ? getOrgLogoUrl(organization.id) : '',
    league_name: 'Wednesday Night Mixed',
    invite_link: getBaseUrl() + '/set-password?token=sample-test-token',
    login_link: getBaseUrl() + '/login',
    dashboard_link: getBaseUrl() + '/bowler-dashboard',
  };

  const subject = `[TEST] ${replaceVariablesPlainText(template.subject, sampleVariables)}`;
  const body = replaceVariables(template.body, sampleVariables);
  const html = wrapInHtmlLayout(sanitizeTemplateBody(body), sampleVariables);

  try {
    await sgMail.send({
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
  } catch (error: any) {
    log.error(`Failed to send test email:`, error?.response?.body || error.message);
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
    await sgMail.send(msg);
    log.info('Password reset email sent to:', isDev ? toEmail : maskEmail(toEmail));
    return true;
  } catch (error: any) {
    log.error('Failed to send password reset email:', error?.response?.body || error.message);
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
