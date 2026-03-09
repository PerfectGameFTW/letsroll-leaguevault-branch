import { storage } from '../storage.js';

const BN_API_BASE = 'https://services.leadconnectorhq.com';
const BN_LOCATION_ID = 'zQw4JcOJlKfJWCWvJ2pw';
const BN_API_VERSION = '2021-07-28';

const CUSTOM_FIELD_IDS = {
  leagueName: 'IQpvYJcn3CbOCA85QCfX',
  teamName: 'xbuBfmYpiXJMx7gcFebZ',
  squareCustomerId: 'K4k6AW8BYc4EWdd76IPD',
  organization: 'poVtF90VhO1CZ2TdD6qQ',
};

function getApiKey(): string | undefined {
  return process.env.BN_API_KEY;
}

function getHeaders(): Record<string, string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('[BowlNow] BN_API_KEY not configured');
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
  return !!getApiKey();
}

export async function findContactByEmail(email: string): Promise<any | null> {
  try {
    const params = new URLSearchParams({
      locationId: BN_LOCATION_ID,
      query: email,
      limit: '1',
    });
    const response = await fetch(`${BN_API_BASE}/contacts/?${params}`, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      console.error('[BowlNow] Error searching contacts:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const contacts = data.contacts || [];
    const match = contacts.find((c: any) =>
      c.email && c.email.toLowerCase() === email.toLowerCase()
    );
    return match || null;
  } catch (error) {
    console.error('[BowlNow] Error finding contact by email:', error);
    return null;
  }
}

export async function createContact(contactData: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  customFields?: { id: string; value: string | string[] }[];
}): Promise<any | null> {
  try {
    const body: any = {
      locationId: BN_LOCATION_ID,
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
      headers: getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[BowlNow] Error creating contact:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    console.log('[BowlNow] Contact created:', data.contact?.id);
    return data.contact;
  } catch (error) {
    console.error('[BowlNow] Error creating contact:', error);
    return null;
  }
}

export async function updateContact(contactId: string, contactData: {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  customFields?: { id: string; value: string | string[] }[];
}): Promise<any | null> {
  try {
    const body: any = {};
    if (contactData.firstName !== undefined) body.firstName = contactData.firstName;
    if (contactData.lastName !== undefined) body.lastName = contactData.lastName;
    if (contactData.email !== undefined) body.email = contactData.email;
    if (contactData.phone !== undefined) body.phone = contactData.phone;
    if (contactData.customFields && contactData.customFields.length > 0) {
      body.customFields = contactData.customFields;
    }

    const response = await fetch(`${BN_API_BASE}/contacts/${contactId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[BowlNow] Error updating contact:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    console.log('[BowlNow] Contact updated:', contactId);
    return data.contact;
  } catch (error) {
    console.error('[BowlNow] Error updating contact:', error);
    return null;
  }
}

export async function syncBowlerToBN(bowlerId: number): Promise<{ success: boolean; contactId?: string; error?: string }> {
  if (!isBNConfigured()) {
    return { success: false, error: 'BowlNow not configured' };
  }

  try {
    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return { success: false, error: 'Bowler not found' };
    }

    const { firstName, lastName } = splitName(bowler.name);

    const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId });
    const leagueNames: string[] = [];
    const teamNames: string[] = [];
    let orgName = '';

    const activeAssociations = bowlerLeagues.filter(bl => bl.active);
    for (const bl of activeAssociations.length > 0 ? activeAssociations : bowlerLeagues.slice(0, 1)) {
      const league = await storage.getLeague(bl.leagueId);
      if (league) {
        if (!leagueNames.includes(league.name)) leagueNames.push(league.name);
        if (!orgName && league.organizationId) {
          const org = await storage.getOrganization(league.organizationId);
          if (org) orgName = org.name;
        }
      }
      if (bl.teamId) {
        const team = await storage.getTeam(bl.teamId);
        if (team && !teamNames.includes(team.name)) teamNames.push(team.name);
      }
    }

    const customFields: { id: string; value: string | string[] }[] = [];
    if (bowler.squareCustomerId) {
      customFields.push({ id: CUSTOM_FIELD_IDS.squareCustomerId, value: bowler.squareCustomerId });
    }
    if (leagueNames.length > 0) {
      customFields.push({ id: CUSTOM_FIELD_IDS.leagueName, value: leagueNames.length === 1 ? leagueNames[0] : leagueNames });
    }
    if (teamNames.length > 0) {
      customFields.push({ id: CUSTOM_FIELD_IDS.teamName, value: teamNames.length === 1 ? teamNames[0] : teamNames });
    }
    if (orgName) {
      customFields.push({ id: CUSTOM_FIELD_IDS.organization, value: orgName });
    }

    let contact: any = null;
    let existingContact: any = null;

    if (bowler.bnContactId) {
      contact = await updateContact(bowler.bnContactId, {
        firstName,
        lastName,
        email: bowler.email || undefined,
        phone: bowler.phone || undefined,
        customFields,
      });
      if (contact) {
        return { success: true, contactId: bowler.bnContactId };
      }
    }

    if (bowler.email) {
      existingContact = await findContactByEmail(bowler.email);
    }

    if (existingContact) {
      contact = await updateContact(existingContact.id, {
        firstName,
        lastName,
        phone: bowler.phone || undefined,
        customFields,
      });
      if (contact) {
        await storage.updateBowlerBnContactId(bowlerId, existingContact.id);
        return { success: true, contactId: existingContact.id };
      }
    }

    contact = await createContact({
      firstName,
      lastName,
      email: bowler.email || undefined,
      phone: bowler.phone || undefined,
      customFields,
    });

    if (contact) {
      await storage.updateBowlerBnContactId(bowlerId, contact.id);
      return { success: true, contactId: contact.id };
    }

    return { success: false, error: 'Failed to create or update contact in BowlNow' };
  } catch (error) {
    console.error('[BowlNow] Error syncing bowler:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function syncAllBowlersToBN(): Promise<{ total: number; synced: number; failed: number; errors: string[] }> {
  if (!isBNConfigured()) {
    return { total: 0, synced: 0, failed: 0, errors: ['BowlNow not configured'] };
  }

  const bowlers = await storage.getBowlers();
  const results = { total: bowlers.length, synced: 0, failed: 0, errors: [] as string[] };

  for (const bowler of bowlers) {
    const result = await syncBowlerToBN(bowler.id);
    if (result.success) {
      results.synced++;
    } else {
      results.failed++;
      results.errors.push(`Bowler ${bowler.id} (${bowler.name}): ${result.error}`);
    }
  }

  console.log(`[BowlNow] Sync complete: ${results.synced}/${results.total} synced, ${results.failed} failed`);
  return results;
}
