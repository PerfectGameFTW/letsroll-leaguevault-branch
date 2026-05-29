import { isDev } from '../config';
import { maskEmail } from '../utils/pii';
import {
  log,
  SENDGRID_API_KEY,
  FROM_EMAIL,
  FROM_NAME,
  dispatchMail,
  describeMailError,
  escapeHtml,
  getBaseUrl,
  getOrgLogoUrl,
  replaceVariables,
  replaceVariablesPlainText,
  sanitizeTemplateBody,
  wrapInHtmlLayout,
} from './email-core';

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
 * Notify a league's org_admins that a Square item variation referenced by
 * the league (Lineage and/or Prize Fund) is no longer present in the live
 * Square catalog (task #654). Mirrors the in-page warning surface in
 * `client/src/components/league-square-catalog.tsx`, but for the case where
 * an admin hasn't opened the Edit-League dialog since the catalog change.
 */
export async function sendLeagueSquareCatalogMissingAlert(
  toEmails: string[],
  details: {
    leagueId: number;
    leagueName: string;
    organizationName: string | null;
    missing: { kind: 'lineage' | 'prizeFund'; itemName: string | null; variationId: string }[];
  },
): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    log.error('Cannot send league Square-catalog missing alert — SENDGRID_API_KEY not configured');
    return false;
  }
  if (toEmails.length === 0) return false;

  const baseUrl = getBaseUrl();
  const editUrl = `${baseUrl}/leagues?editLeague=${details.leagueId}`;
  const safeLeague = escapeHtml(details.leagueName);
  const safeOrg = escapeHtml(details.organizationName || 'your organization');
  const rows = details.missing.map((m) => {
    const label = m.kind === 'lineage' ? 'Lineage' : 'Prize fund';
    const safeName = escapeHtml(m.itemName || '(unnamed item)');
    const safeVar = escapeHtml(m.variationId);
    return `<tr><td style="padding: 6px 0; color: #666; width: 140px;">${label}</td><td style="padding: 6px 0;">${safeName} <span style="color:#999; font-size:12px;">(${safeVar})</span></td></tr>`;
  }).join('');

  const msg = {
    to: toEmails,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `[LeagueVault] Square item missing for league "${details.leagueName}"`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a2e; margin-top: 0;">A Square item used by your league is no longer available</h2>
        <p style="font-size: 14px; color: #333;">
          The league <strong>${safeLeague}</strong> in ${safeOrg} references one or
          more Square catalog items that can no longer be found in your live Square
          catalog. New bowler payments for this league will fail until the league
          is re-pointed at a current Square item.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #333;">
          ${rows}
        </table>
        <div style="margin: 24px 0;">
          <a href="${escapeHtml(editUrl)}" style="background-color: #1a1a2e; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold; display: inline-block;">Open league settings</a>
        </div>
        <p style="font-size: 12px; color: #999;">
          You're receiving this because you're an admin for ${safeOrg}. We will not
          re-send this alert for the same league for at least 24 hours.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">Powered by LeagueVault</p>
      </div>
    `,
    trackingSettings: { clickTracking: { enable: false, enableText: false } },
  };

  try {
    await dispatchMail(msg, true);
    log.info(
      `League Square-catalog missing alert sent to ${toEmails.length} admin(s) for league ${details.leagueId}`,
    );
    return true;
  } catch (error) {
    log.error('Failed to send league Square-catalog missing alert:', describeMailError(error));
    return false;
  }
}
