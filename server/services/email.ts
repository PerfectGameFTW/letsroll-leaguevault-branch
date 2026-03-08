import sgMail from '@sendgrid/mail';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = 'noreply@leaguevault.app';
const FROM_NAME = 'LeagueVault';

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
  console.log('[Email] SendGrid initialized');
} else {
  console.warn('[Email] SENDGRID_API_KEY not set — emails will not be sent');
}

function getBaseUrl(): string {
  if (process.env.REPLIT_DOMAINS) {
    const domains = process.env.REPLIT_DOMAINS.split(',');
    return `https://${domains[0]}`;
  }
  if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
    return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  }
  return 'https://leaguevault.app';
}

export async function sendInviteEmail(
  toEmail: string,
  userName: string,
  inviteToken: string,
  organizationName?: string
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    console.error('[Email] Cannot send invite — SENDGRID_API_KEY not configured');
    return false;
  }

  const baseUrl = getBaseUrl();
  const setupUrl = `${baseUrl}/set-password?token=${inviteToken}`;

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
          &copy; ${new Date().getFullYear()} LeagueVault. All rights reserved.
        </p>
      </div>
    `,
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

export async function resendInviteEmail(
  toEmail: string,
  userName: string,
  inviteToken: string,
  organizationName?: string
): Promise<boolean> {
  return sendInviteEmail(toEmail, userName, inviteToken, organizationName);
}
