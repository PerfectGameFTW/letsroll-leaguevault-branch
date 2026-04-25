/**
 * Behavior tests for the new BowlNow custom-field writes added by
 * task #478. We exercise `syncBowlerToBN` end-to-end (storage +
 * `resolveBowlerLeagueAttributes` + fetch) but stub the network so
 * the assertion is on the OUTGOING request body — i.e. did the sync
 * include the right custom fields with the right IDs?
 *
 * Three contracts are pinned:
 *   1. The `league_season` write is SKIPPED entirely when the org has
 *      not configured a `leagueSeasonFieldId`. Legacy orgs (the
 *      default) keep working — no spurious 400s from BowlNow about
 *      an unknown field ID.
 *   2. When BOTH `leagueNameFieldId` and `leagueSeasonFieldId` are
 *      configured per-org, those override IDs are used in the request
 *      body, not the platform-default `leagueName` constant.
 *   3. The new write path stays NON-FATAL: a BowlNow API failure
 *      surfaces as `{ success: false, error: ... }` and the function
 *      does not throw. (The caller in `payment-customer-sync.ts`
 *      wraps in its own try/catch but should not have to rely on
 *      that for the BN happy path.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgIntegrations } from '@shared/schema';

const getBowler = vi.fn();
const getBowlerLeagues = vi.fn();
const getLeague = vi.fn();
const getTeam = vi.fn();
const getOrganization = vi.fn();
const updateBowlerBnContactId = vi.fn();

vi.mock('../../server/storage', () => ({
  storage: {
    getBowler: (...a: unknown[]) => getBowler(...a),
    getBowlerLeagues: (...a: unknown[]) => getBowlerLeagues(...a),
    getLeague: (...a: unknown[]) => getLeague(...a),
    getTeam: (...a: unknown[]) => getTeam(...a),
    getOrganization: (...a: unknown[]) => getOrganization(...a),
    updateBowlerBnContactId: (...a: unknown[]) => updateBowlerBnContactId(...a),
  },
}));

const { syncBowlerToBN } = await import('../../server/services/bowlnow');

// Each test starts with a fresh fetch spy so the outgoing-body
// assertions are independent.
let fetchSpy: ReturnType<typeof vi.spyOn>;

const PLATFORM_DEFAULT_LEAGUE_NAME_FIELD_ID = 'IQpvYJcn3CbOCA85QCfX';

function makeOrgConfig(overrides: Partial<NonNullable<OrgIntegrations['bowlnow']>>): OrgIntegrations {
  return {
    bowlnow: {
      enabled: true,
      apiKey: 'test-api-key',
      locationId: 'loc-test',
      ...overrides,
    },
  };
}

function arrangeBowlerWithOneLeague() {
  // Bowler with no existing BN contact (so the path goes search →
  // create), and one active membership in one active league. Keeps
  // the request body small + predictable.
  getBowler.mockResolvedValueOnce({
    id: 42,
    name: 'Test Bowler',
    email: 'bowler@test.local',
    phone: '555-0100',
    paymentCustomerId: null,
    bnContactId: null,
  });
  getBowlerLeagues.mockResolvedValue([
    { bowlerId: 42, leagueId: 100, active: true, teamId: null },
  ]);
  getLeague.mockResolvedValue({
    id: 100,
    name: 'Tuesday Night Mixed',
    active: true,
    organizationId: 1,
    seasonStart: '2025-09-01',
    seasonEnd: '2025-12-15',
  });
  getOrganization.mockResolvedValue({ id: 1, name: 'Test Lanes' });
}

beforeEach(() => {
  getBowler.mockReset();
  getBowlerLeagues.mockReset();
  getLeague.mockReset();
  getTeam.mockReset();
  getOrganization.mockReset();
  updateBowlerBnContactId.mockReset();
  fetchSpy = vi.spyOn(global, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.clearAllMocks();
});

describe('syncBowlerToBN — custom-field behavior (task #478)', () => {
  it('skips the league_season write when leagueSeasonFieldId is not configured', async () => {
    arrangeBowlerWithOneLeague();
    // Search returns no contacts → goes to create path.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ contacts: [] }), { status: 200 }),
    );
    // Create succeeds.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ contact: { id: 'bn-new-1' } }), { status: 200 }),
    );

    const orgConfig = makeOrgConfig({}); // no field-ID overrides
    const result = await syncBowlerToBN(42, orgConfig);

    expect(result).toEqual({ success: true, contactId: 'bn-new-1' });

    // The CREATE request is the second fetch call. Inspect its body.
    const createCall = fetchSpy.mock.calls[1];
    expect(createCall[0]).toBe('https://services.leadconnectorhq.com/contacts/');
    const body = JSON.parse((createCall[1] as RequestInit).body as string) as {
      customFields?: { id: string; value: unknown }[];
    };
    const fieldIds = (body.customFields ?? []).map((f) => f.id);
    // league_name still goes (platform default ID), but no season
    // field write because the org hasn't configured one.
    expect(fieldIds).toContain(PLATFORM_DEFAULT_LEAGUE_NAME_FIELD_ID);
    // No platform-default for season — every entry must be a
    // KNOWN field. We confirm the season-tag is absent by checking
    // the value carrying "Fall '25 Season" doesn't appear.
    const values = (body.customFields ?? []).map((f) => f.value);
    expect(values).not.toContain("Fall '25 Season");
  });

  it('uses per-org override IDs for both league_name AND league_season when configured', async () => {
    arrangeBowlerWithOneLeague();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ contacts: [] }), { status: 200 }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ contact: { id: 'bn-new-2' } }), { status: 200 }),
    );

    const orgConfig = makeOrgConfig({
      leagueNameFieldId: 'org-custom-name-id',
      leagueSeasonFieldId: 'org-custom-season-id',
    });
    const result = await syncBowlerToBN(42, orgConfig);

    expect(result.success).toBe(true);

    const createBody = JSON.parse(
      (fetchSpy.mock.calls[1][1] as RequestInit).body as string,
    ) as { customFields: { id: string; value: string | string[] }[] };

    const byId = new Map(createBody.customFields.map((f) => [f.id, f.value]));
    // Override IDs win — the platform-default leagueName ID must
    // NOT appear when the org has overridden it.
    expect(byId.get('org-custom-name-id')).toBe('Tuesday Night Mixed');
    expect(byId.get('org-custom-season-id')).toBe("Fall '25 Season");
    expect(byId.has(PLATFORM_DEFAULT_LEAGUE_NAME_FIELD_ID)).toBe(false);
  });

  it('returns { success: false } without throwing when BowlNow rejects the create', async () => {
    arrangeBowlerWithOneLeague();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ contacts: [] }), { status: 200 }),
    );
    // BowlNow rejects the create with a 400 — the failure must be
    // captured into the return value, NOT thrown out of the
    // function. The caller (payment-customer-sync) relies on this
    // contract to keep card-on-file flows alive when BN is flaky.
    fetchSpy.mockResolvedValueOnce(
      new Response('{"error":"bad request"}', { status: 400 }),
    );

    const orgConfig = makeOrgConfig({
      leagueSeasonFieldId: 'org-custom-season-id',
    });

    const result = await syncBowlerToBN(42, orgConfig);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Contact ID must NOT have been persisted on a failed create.
    expect(updateBowlerBnContactId).not.toHaveBeenCalled();
  });
});
