import sgMail from '@sendgrid/mail';
import { storage } from '../storage.js';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = 'noreply@leaguevault.app';
const FROM_NAME = 'LeagueVault';

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
  console.log('[Email] SendGrid initialized');
} else {
  console.warn('[Email] SENDGRID_API_KEY not set — emails will not be sent');
}

export function getBaseUrl(): string {
  if (process.env.REPLIT_DOMAINS) {
    const domains = process.env.REPLIT_DOMAINS.split(',');
    return `https://${domains[0]}`;
  }
  if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
    return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  }
  return 'https://leaguevault.app';
}

function replaceVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}

function getOrgLogoUrl(orgId: number | string): string {
  const baseUrl = getBaseUrl();
  return `${baseUrl}/api/organizations/${orgId}/logo`;
}

function convertLinksToButtons(html: string): string {
  return html.replace(
    /^\s*(https?:\/\/[^\s<]+)\s*$/gm,
    (_match, url) => {
      let label = 'Click Here';
      if (url.includes('/set-password')) label = 'Set Up Your Password';
      else if (url.includes('/bowler-dashboard') || url.includes('/dashboard')) label = 'Go to Dashboard';
      else if (url.includes('/login')) label = 'Log In';
      else if (url.includes('/claim')) label = 'Claim Your Profile';

      return `<div style="margin: 20px 0;"><a href="${url}" style="display: inline-block; background-color: #1a1a2e; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold;">${label}</a></div>`;
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
    console.error('[Email] Cannot send email — SENDGRID_API_KEY not configured');
    return false;
  }

  try {
    const template = await storage.getEmailTemplateBySlug(slug);
    if (!template || !template.active) {
      console.log(`[Email] Template '${slug}' not found or inactive, skipping`);
      return false;
    }

    const subject = replaceVariables(template.subject, variables);
    const body = replaceVariables(template.body, variables);
    const html = wrapInHtmlLayout(body, variables);

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
    console.log(`[Email] Templated email '${slug}' sent to:`, toEmail);
    return true;
  } catch (error: any) {
    console.error(`[Email] Failed to send templated email '${slug}':`, error?.response?.body || error.message);
    return false;
  }
}

export async function sendInviteEmail(
  toEmail: string,
  userName: string,
  inviteToken: string,
  organizationName?: string,
  organizationId?: number
): Promise<boolean> {
  const baseUrl = getBaseUrl();
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
    console.error('[Email] Cannot send invite — SENDGRID_API_KEY not configured');
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
    console.log('[Email] Invite email sent to:', toEmail);
    return true;
  } catch (error: any) {
    console.error('[Email] Failed to send invite email:', error?.response?.body || error.message);
    return false;
  }
}

export async function sendTestEmail(
  template: { subject: string; body: string; slug: string },
  toEmail: string,
  organization?: { id: number; name: string; logo?: string | null } | null
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    console.error('[Email] Cannot send test email — SENDGRID_API_KEY not configured');
    return false;
  }

  const sampleVariables: Record<string, string> = {
    bowler_name: 'John Smith',
    organization_name: organization?.name || 'Sample Bowling Center',
    organization_logo_url: organization?.logo ? getOrgLogoUrl(organization.id) : '',
    league_name: 'Wednesday Night Mixed',
    invite_link: getBaseUrl() + '/set-password?token=sample-test-token',
    login_link: getBaseUrl() + '/login',
    dashboard_link: getBaseUrl() + '/bowler-dashboard',
  };

  const subject = `[TEST] ${replaceVariables(template.subject, sampleVariables)}`;
  const body = replaceVariables(template.body, sampleVariables);
  const html = wrapInHtmlLayout(body, sampleVariables);

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
    console.log(`[Email] Test email for '${template.slug}' sent to:`, toEmail);
    return true;
  } catch (error: any) {
    console.error(`[Email] Failed to send test email:`, error?.response?.body || error.message);
    return false;
  }
}

export async function resendInviteEmail(
  toEmail: string,
  userName: string,
  inviteToken: string,
  organizationName?: string,
  organizationId?: number
): Promise<boolean> {
  return sendInviteEmail(toEmail, userName, inviteToken, organizationName, organizationId);
}
