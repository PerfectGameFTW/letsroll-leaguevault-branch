import { storage } from '../storage';
import type { OrgIntegrations } from '@shared/schema';
import { env } from '../config';
import { createLogger } from '../logger';
import { resolveBowlerLeagueAttributes } from './bowler-attributes';

const log = createLogger("BowlNowService");

const BN_API_BASE = 'https://services.leadconnectorhq.com';
const DEFAULT_BN_LOCATION_ID = 'zQw4JcOJlKfJWCWvJ2pw';
const BN_API_VERSION = '2021-07-28';

// Platform-default custom-field IDs for the canonical BowlNow
// location. Per-org overrides live on
// `OrgIntegrations.bowlnow.{leagueName,leagueSeason}FieldId` because
// each BowlNow location has its own opaque field IDs created
// manually in the BN dashboard. The season-field ID has NO default
// — orgs that haven't pasted one in get the season-tag write skipped
// (task #478), keeping legacy behavior intact for existing setups.
const CUSTOM_FIELD_IDS = {
  leagueName: 'IQpvYJcn3CbOCA85QCfX',
  teamName: 'xbuBfmYpiXJMx7gcFebZ',
  squareCustomerId: 'K4k6AW8BYc4EWdd76IPD',
  organization: 'poVtF90VhO1CZ2TdD6qQ',
};

function resolveLeagueNameFieldId(orgConfig?: OrgIntegrations | null): string {
  return orgConfig?.bowlnow?.leagueNameFieldId || CUSTOM_FIELD_IDS.leagueName;
}

function resolveLeagueSeasonFieldId(orgConfig?: OrgIntegrations | null): string | undefined {
  // No platform default — see comment on CUSTOM_FIELD_IDS above.
  return orgConfig?.bowlnow?.leagueSeasonFieldId || undefined;
}

export interface BNContact {
  id?: string;
  email?: string | null;
  firstName?: string;
  lastName?: string;
  phone?: string;
  locationId?: string;
  customFields?: { id: string; value: string | string[] }[];
  [extra: string]: unknown;
}

interface BNContactWriteBody {
  locationId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  customFields?: { id: string; value: string | string[] }[];
}

function getGlobalApiKey(): string | undefined {
  return env.BN_API_KEY;
}

function resolveApiKey(orgConfig?: OrgIntegrations | null): string | undefined {
  const orgKey = orgConfig?.bowlnow?.apiKey;
  if (orgKey) return orgKey;
  return getGlobalApiKey();
}

function resolveLocationId(orgConfig?: OrgIntegrations | null): string {
  return orgConfig?.bowlnow?.locationId || DEFAULT_BN_LOCATION_ID;
}

function getHeaders(apiKey: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Version': BN_API_VERSION,
    'Content-Type': 'application/json',
  };
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

export function isBNConfigured(): boolean {
  return !!getGlobalApiKey();
}

export function isOrgBNConfigured(orgConfig: OrgIntegrations | null | undefined): boolean {
  if (!orgConfig?.bowlnow?.enabled) return false;
  return !!orgConfig.bowlnow.apiKey;
}

export async function getOrgBNConfig(orgId: number): Promise<OrgIntegrations | null> {
  return storage.getOrgIntegrations(orgId);
}

export async function findContactByEmail(email: string, orgConfig?: OrgIntegrations | null): Promise<BNContact | null> {
  try {
    const apiKey = resolveApiKey(orgConfig);
    if (!apiKey) return null;
    const locationId = resolveLocationId(orgConfig);

    const params = new URLSearchParams({
      locationId,
      query: email,
      limit: '1',
    });
    const response = await fetch(`${BN_API_BASE}/contacts/?${params}`, {
      method: 'GET',
      headers: getHeaders(apiKey),
    });

    if (!response.ok) {
      log.error('Error searching contacts:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const contacts = data.contacts || [];
    const match = (contacts as BNContact[]).find((c) =>
      c.email !== undefined && c.email !== null && c.email.toLowerCase() === email.toLowerCase()
    );
    return match || null;
  } catch (error) {
    log.error('Error finding contact by email:', error);
    return null;
  }
}

export async function createContact(contactData: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  customFields?: { id: string; value: string | string[] }[];
}, orgConfig?: OrgIntegrations | null): Promise<BNContact | null> {
  try {
    const apiKey = resolveApiKey(orgConfig);
    if (!apiKey) return null;
    const locationId = resolveLocationId(orgConfig);

    const body: BNContactWriteBody = {
      locationId,
      firstName: contactData.firstName,
      lastName: contactData.lastName,
    };
    if (contactData.email) body.email = contactData.email;
    if (contactData.phone) body.phone = contactData.phone;
    if (contactData.customFields && contactData.customFields.length > 0) {
      body.customFields = contactData.customFields;
    }

    const response = await fetch(`${BN_API_BASE}/contacts/`, {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Error creating contact:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    log.info('Contact created:', data.contact?.id);
    return data.contact;
  } catch (error) {
    log.error('Error creating contact:', error);
    return null;
  }
}

export async function updateContact(contactId: string, contactData: {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  customFields?: { id: string; value: string | string[] }[];
}, orgConfig?: OrgIntegrations | null): Promise<BNContact | null> {
  try {
    const apiKey = resolveApiKey(orgConfig);
    if (!apiKey) return null;

    const body: BNContactWriteBody = {};
    if (contactData.firstName !== undefined) body.firstName = contactData.firstName;
    if (contactData.lastName !== undefined) body.lastName = contactData.lastName;
    if (contactData.email !== undefined) body.email = contactData.email;
    if (contactData.phone !== undefined) body.phone = contactData.phone;
    if (contactData.customFields && contactData.customFields.length > 0) {
      body.customFields = contactData.customFields;
    }

    const response = await fetch(`${BN_API_BASE}/contacts/${contactId}`, {
      method: 'PUT',
      headers: getHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Error updating contact:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    log.info('Contact updated:', contactId);
    return data.contact;
  } catch (error) {
    log.error('Error updating contact:', error);
    return null;
  }
}

export async function syncBowlerToBN(
  bowlerId: number,
  orgConfig?: OrgIntegrations | null,
): Promise<{ success: boolean; contactId?: string; error?: string }> {
  const hasOrgContext = orgConfig !== undefined;
  if (hasOrgContext && !isOrgBNConfigured(orgConfig)) {
    return { success: false, error: 'BowlNow not configured for this organization' };
  }
  if (!hasOrgContext && !isBNConfigured()) {
    return { success: false, error: 'BowlNow not configured' };
  }

  const effectiveConfig = orgConfig ?? null;

  try {
    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return { success: false, error: 'Bowler not found' };
    }

    const { firstName, lastName } = splitName(bowler.name);

    // League names + season labels come from the SHARED helper used by
    // the Square sync (task #478), so a Square Smart List filter and a
    // BowlNow Smart List filter on the same value resolve to the same
    // bowler audience. The team/org enrichment below stays distinct
    // from the league-attribute helper because BowlNow needs the org-
    // name pretty string and any team association for its own Smart
    // List filters — those have no Square parallel today.
    const attrs = await resolveBowlerLeagueAttributes(bowlerId);
    const leagueNames = attrs.leagueNames;
    const leagueSeasons = attrs.leagueSeasons;

    const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId });
    const teamNames: string[] = [];
    let orgName = '';

    const activeAssociations = bowlerLeagues.filter(bl => bl.active);
    for (const bl of activeAssociations.length > 0 ? activeAssociations : bowlerLeagues.slice(0, 1)) {
      if (!orgName) {
        const league = await storage.getLeague(bl.leagueId);
        if (league?.organizationId) {
          const org = await storage.getOrganization(league.organizationId);
          if (org) orgName = org.name;
        }
      }
      if (bl.teamId) {
        const team = await storage.getTeam(bl.teamId);
        if (team && !teamNames.includes(team.name)) teamNames.push(team.name);
      }
    }

    const leagueNameFieldId = resolveLeagueNameFieldId(effectiveConfig);
    const leagueSeasonFieldId = resolveLeagueSeasonFieldId(effectiveConfig);

    const customFields: { id: string; value: string | string[] }[] = [];
    if (bowler.paymentCustomerId) {
      customFields.push({ id: CUSTOM_FIELD_IDS.squareCustomerId, value: bowler.paymentCustomerId });
    }
    if (leagueNames.length > 0) {
      // Single string for length 1 / array for length 2+ matches the
      // pre-existing convention so existing BN Smart Lists keep
      // working. BowlNow's multi-value field accepts both shapes.
      customFields.push({
        id: leagueNameFieldId,
        value: leagueNames.length === 1 ? leagueNames[0] : leagueNames,
      });
    }
    if (leagueSeasonFieldId && leagueSeasons.length > 0) {
      // Same single/array convention as `leagueName`. Skipped
      // entirely when the org hasn't pasted a season-field ID into
      // their integration settings yet — the sync stays non-fatal
      // (task #478 spec).
      customFields.push({
        id: leagueSeasonFieldId,
        value: leagueSeasons.length === 1 ? leagueSeasons[0] : leagueSeasons,
      });
    }
    if (teamNames.length > 0) {
      customFields.push({ id: CUSTOM_FIELD_IDS.teamName, value: teamNames.length === 1 ? teamNames[0] : teamNames });
    }
    if (orgName) {
      customFields.push({ id: CUSTOM_FIELD_IDS.organization, value: orgName });
    }

    let contact: BNContact | null = null;
    let existingContact: BNContact | null = null;

    if (bowler.bnContactId) {
      contact = await updateContact(bowler.bnContactId, {
        firstName,
        lastName,
        email: bowler.email || undefined,
        phone: bowler.phone || undefined,
        customFields,
      }, effectiveConfig);
      if (contact) {
        return { success: true, contactId: bowler.bnContactId };
      }
    }

    if (bowler.email) {
      existingContact = await findContactByEmail(bowler.email, effectiveConfig);
    }

    if (existingContact?.id) {
      const existingId = existingContact.id;
      contact = await updateContact(existingId, {
        firstName,
        lastName,
        phone: bowler.phone || undefined,
        customFields,
      }, effectiveConfig);
      if (contact) {
        await storage.updateBowlerBnContactId(bowlerId, existingId);
        return { success: true, contactId: existingId };
      }
    }

    contact = await createContact({
      firstName,
      lastName,
      email: bowler.email || undefined,
      phone: bowler.phone || undefined,
      customFields,
    }, effectiveConfig);

    if (contact?.id) {
      await storage.updateBowlerBnContactId(bowlerId, contact.id);
      return { success: true, contactId: contact.id };
    }

    return { success: false, error: 'Failed to create or update contact in BowlNow' };
  } catch (error) {
    log.error('Error syncing bowler:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function syncAllBowlersToBN(
  organizationId: number,
  orgConfig?: OrgIntegrations | null,
): Promise<{ total: number; synced: number; failed: number; errors: string[] }> {
  const hasOrgContext = orgConfig !== undefined;
  if (hasOrgContext && !isOrgBNConfigured(orgConfig)) {
    return { total: 0, synced: 0, failed: 0, errors: ['BowlNow not configured for this organization'] };
  }
  if (!hasOrgContext && !isBNConfigured()) {
    return { total: 0, synced: 0, failed: 0, errors: ['BowlNow not configured'] };
  }

  const bowlers = await storage.getBowlers({ organizationId });
  const results = { total: bowlers.length, synced: 0, failed: 0, errors: [] as string[] };

  // Lazy-import the retry-flag helper to avoid a hard dependency cycle:
  // bowlnow.ts is the lowest BN layer and is imported by both the
  // retry sweep and the flag helper.
  const { flagBowlerForBnRetry, clearBowlerBnRetry } = await import('./bowlnow-retry-flag.js');
  for (const bowler of bowlers) {
    let result: { success: boolean; error?: string };
    try {
      result = await syncBowlerToBN(bowler.id, orgConfig);
    } catch (e) {
      result = { success: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (result.success) {
      results.synced++;
      // Clear any prior pending/attempt state on success so a row that
      // hit max attempts earlier doesn't stay stuck (architect review
      // on #480).
      await clearBowlerBnRetry(bowler.id);
    } else {
      results.failed++;
      results.errors.push(`Bowler ${bowler.id} (${bowler.name}): ${result.error}`);
      // Queue the bowler into the retry sweep so transient BN failures
      // during the org-wide sync get picked up later (task #480 review).
      await flagBowlerForBnRetry(bowler.id);
    }
  }

  log.info(`Sync complete: ${results.synced}/${results.total} synced, ${results.failed} failed`);
  return results;
}
