/**
 * Round-trip tests for the BowlNow custom-field IDs in the
 * /api/integrations endpoints (task #481).
 *
 * Task #479 added two optional inputs — `leagueNameFieldId` and
 * `leagueSeasonFieldId` — to the BowlNow settings form, and extended
 * both GET and PATCH /api/integrations to round-trip them. The
 * existing `list-routes-filter-validation.test.ts` only covers the
 * 400 paths (status codes + error messages); there was no test that
 * pinning these specific fields through GET → PATCH → GET actually
 * persists the value, clears it on explicit empty string, and
 * preserves it when the PATCH body omits the keys.
 *
 * The "omitted = preserve" case is the most important contract here —
 * the BowlNow toggle path on the settings card sends only
 * `{enabled: false}` (or `{enabled: true}`), and a previous bug would
 * have wiped the per-org custom-field IDs on every routine save. This
 * file pins all three branches of the merge so a future refactor of
 * the GET projection or the PATCH merge logic can't silently
 * regress them.
 *
 * Test pattern: a tiny express app mounting only the integrations
 * router, with an in-memory `storage.getOrgIntegrations` /
 * `updateOrgIntegrations` pair so GET → PATCH → GET actually returns
 * what the previous PATCH wrote.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { OrgIntegrations } from '@shared/schema';

// ---------------------------------------------------------------------------
// In-memory storage mock — keyed by orgId so the same GET / PATCH /
// GET sequence the real client would issue actually reads its own
// writes. Reset in beforeEach so each test gets a clean slate.
// ---------------------------------------------------------------------------
const orgStore = new Map<number, OrgIntegrations | undefined>();

const mockStorage = {
  getOrgIntegrations: vi.fn(async (orgId: number) => orgStore.get(orgId)),
  updateOrgIntegrations: vi.fn(
    async (orgId: number, payload: OrgIntegrations) => {
      orgStore.set(orgId, payload);
    },
  ),
};
vi.mock('../../server/storage', () => ({ storage: mockStorage }));

// ---------------------------------------------------------------------------
// Lazy router import — must come AFTER vi.mock so the mocked storage
// is wired in.
// ---------------------------------------------------------------------------
const integrationsRouter = (await import('../../server/routes/integrations')).default;

type TestRole = 'system_admin' | 'org_admin' | 'admin' | 'user';
interface TestUser {
  id: number;
  role: TestRole;
  organizationId: number | null;
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const raw = req.header('x-test-user');
    if (raw) {
      const parsed = JSON.parse(raw) as TestUser;
      (req as unknown as { user: TestUser }).user = parsed;
      (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated =
        () => true;
    } else {
      (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated =
        () => false;
    }
    next();
  });
  app.use('/api/integrations', integrationsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  orgStore.clear();
  // Pre-seed the org with a stored apiKey so PATCHes with
  // `enabled: true` don't 400 on the "API key required to enable"
  // guard. The roundtrip we're testing is for the field-ID values,
  // not the enable guard, which has its own test in the existing
  // route-validation file.
  orgStore.set(1, { bowlnow: { enabled: true, apiKey: 'preseed-key' } });
  mockStorage.getOrgIntegrations.mockClear();
  mockStorage.updateOrgIntegrations.mockClear();
});

afterEach(() => vi.clearAllMocks());

const ORG_USER: TestUser = { id: 7, role: 'org_admin', organizationId: 1 };

function userHeader(user: TestUser) {
  return { 'x-test-user': JSON.stringify(user) };
}

async function getIntegrations() {
  const res = await fetch(`${baseUrl}/api/integrations`, {
    method: 'GET',
    headers: userHeader(ORG_USER),
  });
  return { status: res.status, body: (await res.json()) as { data?: { bowlnow: Record<string, unknown> } } };
}

async function patchIntegrations(bowlnow: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/integrations`, {
    method: 'PATCH',
    headers: { ...userHeader(ORG_USER), 'content-type': 'application/json' },
    body: JSON.stringify({ bowlnow }),
  });
  return { status: res.status, body: (await res.json()) as { data?: { bowlnow: Record<string, unknown> } } };
}

describe('PATCH/GET /api/integrations — BowlNow custom field ID round-trip', () => {
  it('persists non-empty leagueNameFieldId + leagueSeasonFieldId through PATCH → GET', async () => {
    const patched = await patchIntegrations({
      enabled: true,
      leagueNameFieldId: 'cf_league_name_abc123',
      leagueSeasonFieldId: 'cf_league_season_xyz789',
    });
    expect(patched.status).toBe(200);
    // The PATCH response itself should already echo the stored values.
    expect(patched.body.data?.bowlnow.leagueNameFieldId).toBe('cf_league_name_abc123');
    expect(patched.body.data?.bowlnow.leagueSeasonFieldId).toBe('cf_league_season_xyz789');

    // And a fresh GET should return the same values — this is the
    // contract the settings form depends on to pre-populate after a
    // page reload.
    const fetched = await getIntegrations();
    expect(fetched.status).toBe(200);
    expect(fetched.body.data?.bowlnow.leagueNameFieldId).toBe('cf_league_name_abc123');
    expect(fetched.body.data?.bowlnow.leagueSeasonFieldId).toBe('cf_league_season_xyz789');
  });

  it('clears a previously-stored field ID when PATCHed with an explicit empty string', async () => {
    // Seed a stored value first.
    await patchIntegrations({
      enabled: true,
      leagueNameFieldId: 'cf_old_name',
      leagueSeasonFieldId: 'cf_old_season',
    });

    // Now clear them via explicit empty strings — this is what the
    // form sends when the admin emptied the input and clicked Save.
    const cleared = await patchIntegrations({
      enabled: true,
      leagueNameFieldId: '',
      leagueSeasonFieldId: '',
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data?.bowlnow.leagueNameFieldId).toBe('');
    expect(cleared.body.data?.bowlnow.leagueSeasonFieldId).toBe('');

    const fetched = await getIntegrations();
    expect(fetched.status).toBe(200);
    expect(fetched.body.data?.bowlnow.leagueNameFieldId).toBe('');
    expect(fetched.body.data?.bowlnow.leagueSeasonFieldId).toBe('');
  });

  it('preserves a previously-stored field ID when the PATCH body omits the key (toggle-path contract)', async () => {
    // This is the contract that protects the toggle path on the
    // BowlNow settings card. The toggle sends only `{enabled: ...}`
    // — without this preserve-on-omit behaviour, every routine
    // enable/disable click would silently wipe the per-org custom
    // field IDs and quietly disable league/season tag writes for
    // the org.
    await patchIntegrations({
      enabled: true,
      leagueNameFieldId: 'cf_keep_name',
      leagueSeasonFieldId: 'cf_keep_season',
    });

    // Toggle-style PATCH: only `enabled`, no field ID keys at all.
    const toggled = await patchIntegrations({ enabled: false });
    expect(toggled.status).toBe(200);
    expect(toggled.body.data?.bowlnow.leagueNameFieldId).toBe('cf_keep_name');
    expect(toggled.body.data?.bowlnow.leagueSeasonFieldId).toBe('cf_keep_season');

    const fetched = await getIntegrations();
    expect(fetched.status).toBe(200);
    expect(fetched.body.data?.bowlnow.leagueNameFieldId).toBe('cf_keep_name');
    expect(fetched.body.data?.bowlnow.leagueSeasonFieldId).toBe('cf_keep_season');
  });

  it('preserves only one field ID when the PATCH body sends an empty string for the other', async () => {
    // Mixed case — admin clears the season field but leaves the name
    // field alone (form sends both, but season as ''). Verifies the
    // two fields are independent and the merge logic is per-field,
    // not all-or-nothing.
    await patchIntegrations({
      enabled: true,
      leagueNameFieldId: 'cf_keep_name',
      leagueSeasonFieldId: 'cf_drop_season',
    });

    const mixed = await patchIntegrations({
      enabled: true,
      leagueNameFieldId: 'cf_keep_name',
      leagueSeasonFieldId: '',
    });
    expect(mixed.status).toBe(200);
    expect(mixed.body.data?.bowlnow.leagueNameFieldId).toBe('cf_keep_name');
    expect(mixed.body.data?.bowlnow.leagueSeasonFieldId).toBe('');

    const fetched = await getIntegrations();
    expect(fetched.body.data?.bowlnow.leagueNameFieldId).toBe('cf_keep_name');
    expect(fetched.body.data?.bowlnow.leagueSeasonFieldId).toBe('');
  });
});
