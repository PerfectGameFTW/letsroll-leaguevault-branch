/**
 * Route-level throttle test for the self-serve payment-sync retry
 * endpoint (task #365).
 *
 * The companion suite tests/unit/retry-payment-sync-routes.test.ts
 * mocks `express-rate-limit` out of the way so it can exercise the
 * authz / contract cases without burning rate-limit budget. THIS
 * file deliberately does NOT mock the limiter — it loads the real
 * express-rate-limit middleware so we can prove that:
 *
 *   - the first 5 retry calls in a one-minute window succeed
 *   - the 6th call from the same authenticated user is rejected with
 *     429 RATE_LIMITED via the standard sendError envelope
 *   - the rate-limited request never reaches the sync worker (so the
 *     limiter is wired BEFORE the handler, not after)
 *
 * The shared-Postgres store is replaced with `undefined` so the
 * limiter falls back to express-rate-limit's in-memory store; this
 * gives us a fresh per-process budget that the test can fully
 * consume without contaminating other tests.
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
import express, { type Request } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const PLAIN_USER_LINKED = {
  id: 6101,
  email: 'throttle@vitest.local',
  name: 'Throttled User',
  role: 'user' as const,
  organizationId: 12,
  locationId: 7,
  bowlerId: 8801,
  phone: null,
  preferredLanguage: null,
  avatar: null,
  password: 'hashed:irrelevant',
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

// --- Module mocks. Hoisted by vitest. ----------------------------
//
// IMPORTANT: we do NOT mock 'express-rate-limit' here — that is the
// whole point of this file.

const mockGetBowler = vi.fn();
const mockSyncBowlerForUser = vi.fn();

vi.mock('../../server/storage', () => ({
  storage: {
    getBowler: (...a: unknown[]) => mockGetBowler.apply(null, a as never),
    getUserByBowlerId: vi.fn(),
    getEmailChangeRequestByTokenHash: vi.fn(),
    consumeEmailChangeRequest: vi.fn(),
  },
}));

vi.mock('../../server/services/payment-customer-sync', async () => {
  const actual = await vi.importActual<
    typeof import('../../server/services/payment-customer-sync')
  >('../../server/services/payment-customer-sync');
  return {
    ...actual,
    syncBowlerForUser: (...a: unknown[]) =>
      mockSyncBowlerForUser.apply(null, a as never),
  };
});

vi.mock('../../server/auth', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
  destroyOtherSessionsForUser: vi.fn(async () => 0),
}));

vi.mock('../../server/services/email', () => ({
  sendDeletionRequestNotification: vi.fn(async () => true),
  sendEmailChangeConfirmation: vi.fn(async () => true),
  sendEmailChangeNotification: vi.fn(async () => true),
  sendPasswordChangedNotification: vi.fn(async () => true),
  getBaseUrl: () => 'https://test.example',
}));

vi.mock('../../server/db', () => ({
  db: { transaction: vi.fn(), select: vi.fn(), update: vi.fn() },
}));

vi.mock('../../server/storage/admin-email-change-audits', () => ({
  recordAdminEmailChangeAudit: vi.fn(async () => undefined),
}));

// Force the limiter to fall back to express-rate-limit's in-memory
// store so the test gets a fresh, per-process budget. The real
// production wiring uses a shared Postgres store (task #356); that's
// covered by tests/unit/rate-limit-store.test.ts.
vi.mock('../../server/utils/rate-limit-store', () => ({
  createSharedRateLimitStore: () => undefined,
}));

vi.mock('../../server/config', () => ({
  isDev: false,
  env: {
    NODE_ENV: 'test',
    SESSION_SECRET: 'x'.repeat(64),
    DATABASE_URL: 'postgres://test/test',
    APP_BASE_URL: 'https://test.example',
  },
}));

// --- Build the test harness. -------------------------------------

let server: Server;
let baseUrl: string;
// Per-test auth + IP overrides. Each test owns a fresh process-wide
// limiter bucket because tests use distinct user ids / IPs (or the
// limiter's in-memory store is reset between cases via a fresh
// keyGenerator key) so cross-case pollution is avoided.
let nextAuthState: { isAuthenticated: boolean; user: typeof PLAIN_USER_LINKED | null } = {
  isAuthenticated: true,
  user: PLAIN_USER_LINKED,
};
let nextIp = '198.51.100.42';

beforeAll(async () => {
  const accountRouter = (await import('../../server/routes/account')).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'ip', { value: nextIp, configurable: true });
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () =>
      nextAuthState.isAuthenticated;
    (req as unknown as { user: unknown }).user = nextAuthState.user;
    (req as unknown as { sessionID: string }).sessionID = 'test-session';
    (req as unknown as { session: unknown }).session = {};
    next();
  });
  app.use('/api/account', accountRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  mockGetBowler.mockReset();
  mockSyncBowlerForUser.mockReset();
  mockGetBowler.mockResolvedValue({
    id: PLAIN_USER_LINKED.bowlerId,
    name: PLAIN_USER_LINKED.name,
    email: PLAIN_USER_LINKED.email,
    phone: null,
  });
  mockSyncBowlerForUser.mockResolvedValue('synced');
  // Reset to authenticated default; individual tests override.
  nextAuthState = { isAuthenticated: true, user: PLAIN_USER_LINKED };
  nextIp = '198.51.100.42';
});

afterEach(() => vi.clearAllMocks());

async function postRetry() {
  const res = await fetch(`${baseUrl}/api/account/profile/retry-payment-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return { status: res.status, body: await res.json() };
}

// --- Tests --------------------------------------------------------

describe('POST /api/account/profile/retry-payment-sync rate limit (#365)', () => {
  it('allows the first 5 retries in the window and rejects the 6th with 429 RATE_LIMITED', async () => {
    // Burn the budget exactly. The 5/min cap is intentionally tight
    // because every successful call hits the payment provider; if a
    // future change loosens or removes this guard, this test will
    // start failing on the 6th iteration with a 200 instead of 429.
    for (let i = 0; i < 5; i++) {
      const { status, body } = await postRetry();
      expect(status, `call #${i + 1} should still be within budget`).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.paymentSyncStatus).toBe('synced');
    }

    const { status, body } = await postRetry();
    expect(status).toBe(429);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('RATE_LIMITED');

    // Limiter must short-circuit BEFORE the handler runs — otherwise
    // the throttle wouldn't actually relieve pressure on the payment
    // provider, which is the whole point of #365.
    expect(mockSyncBowlerForUser).toHaveBeenCalledTimes(5);
    expect(mockGetBowler).toHaveBeenCalledTimes(5);
  });

  it('throttles unauthenticated bursts on the IP fallback bucket — pinning the limiter-before-requireAuth ordering', async () => {
    // Use a fresh IP so this test gets its own bucket independent of
    // the authenticated-user test above. If the limiter were
    // accidentally moved AFTER requireAuth in a future refactor,
    // call #6 below would also return 401 (because requireAuth would
    // run first and short-circuit) instead of 429 — that's exactly
    // the regression this test is designed to catch.
    nextAuthState = { isAuthenticated: false, user: null };
    nextIp = '198.51.100.77';

    for (let i = 0; i < 5; i++) {
      const { status, body } = await postRetry();
      expect(status, `unauth call #${i + 1} should hit auth gate, not limiter`).toBe(401);
      expect(body.success).toBe(false);
      // The shape of the auth-required envelope isn't asserted in
      // detail here — the companion route-test file already pins it.
    }

    const { status, body } = await postRetry();
    expect(status).toBe(429);
    expect(body.error?.code).toBe('RATE_LIMITED');

    // Worker is never reached on any of the unauth calls (limiter
    // either lets requireAuth handle the rejection or rejects
    // outright on the 6th).
    expect(mockSyncBowlerForUser).not.toHaveBeenCalled();
    expect(mockGetBowler).not.toHaveBeenCalled();
  });
});
