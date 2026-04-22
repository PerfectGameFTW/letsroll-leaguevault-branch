/**
 * Route-level tests for /api/payments CRUD + refund (task #309).
 *
 * The /api/payments routes (now split across
 * `server/routes/payments/payment-record.ts` and
 * `server/routes/payments/payment-refunds.ts`) handle money movement,
 * idempotency-key dedup, paid-in-full schedule cancellation, refund
 * provider delegation, and access control. After the recent refactor
 * these had no dedicated route-level tests.
 *
 * These tests mount the real routers onto an isolated Express app with
 * the storage / access-control / payment-provider / db / rate-limiter
 * modules mocked, then drive each endpoint over real HTTP via `fetch`.
 *
 * Coverage matrix:
 *   POST   /api/payments
 *     - happy path → 201
 *     - league not found → 404
 *     - cross-org access denied → 403
 *     - check payment missing checkNumber → 400
 *     - idempotency dedup (same league) returns existing 200
 *     - idempotency conflict (different league) → 409
 *     - paid-in-full triggers schedule deactivation + scheduler removal
 *   PATCH  /api/payments/:id
 *     - happy path → 200
 *     - non-admin lacking access → 403
 *     - not found → 404
 *     - check type without checkNumber → 400
 *   DELETE /api/payments/:id
 *     - happy path → 200
 *     - invalid id → 400
 *     - not found → 404
 *     - card payment by non-admin → 403
 *     - non-admin lacking access → 403
 *   POST   /api/payments/:id/refund
 *     - happy path: provider delegation + storage.refundPayment → 200
 *     - non-admin → 403
 *     - already refunded → 400
 *     - status not paid → 400
 *     - non-card payment type → 400
 *     - provider not configured → 422
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

const mockStorage = {
  getLeague: vi.fn(),
  getPaymentByIdempotencyKey: vi.fn(),
  createPayment: vi.fn(),
  getPaymentSchedule: vi.fn(),
  deactivatePaymentSchedule: vi.fn(),
  getPaymentById: vi.fn(),
  updatePayment: vi.fn(),
  deletePayment: vi.fn(),
  refundPayment: vi.fn(),
};

vi.mock('../../server/storage', () => ({ storage: mockStorage }));

const mockHasAccessToPayment = vi.fn();
const mockRequireOrgAccess = vi.fn();
vi.mock('../../server/utils/access-control', () => ({
  hasAccessToPayment: (...a: unknown[]) => mockHasAccessToPayment(...a),
  requireOrganizationAccess: (...a: unknown[]) => mockRequireOrgAccess(...a),
}));

const mockRemoveSchedule = vi.fn();
vi.mock('../../server/services/payment-scheduler', () => ({
  paymentScheduler: { removeSchedule: (...a: unknown[]) => mockRemoveSchedule(...a) },
}));

const mockGetPaymentProvider = vi.fn();
class FakeProviderNotConfiguredError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ProviderNotConfiguredError';
  }
}
vi.mock('../../server/services/payment-provider-factory', () => ({
  getPaymentProvider: (...a: unknown[]) => mockGetPaymentProvider(...a),
  ProviderNotConfiguredError: FakeProviderNotConfiguredError,
}));

const mockSumQuery = vi.fn();
vi.mock('../../server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (..._a: unknown[]) => mockSumQuery(),
      }),
    }),
  },
}));

// No-op the per-IP rate limiter so a single test run doesn't get
// throttled (default is 30/15min and we make ~20 calls).
vi.mock('../../server/middleware/rate-limit', () => ({
  paymentWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  paymentLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Imports must come after vi.mock declarations.
const paymentRecordRouter = (await import('../../server/routes/payments/payment-record')).default;
const paymentRefundsRouter = (await import('../../server/routes/payments/payment-refunds')).default;

type TestRole = 'system_admin' | 'org_admin' | 'admin' | 'user';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Inject req.user from a test header to simulate auth.
  app.use((req, _res, next) => {
    const raw = req.header('x-test-user');
    if (raw) (req as unknown as { user: unknown }).user = JSON.parse(raw);
    next();
  });
  app.use('/api/payments', paymentRecordRouter);
  app.use('/api/payments', paymentRefundsRouter);

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
  for (const fn of Object.values(mockStorage)) (fn as ReturnType<typeof vi.fn>).mockReset();
  mockHasAccessToPayment.mockReset();
  mockRequireOrgAccess.mockReset();
  mockRemoveSchedule.mockReset();
  mockGetPaymentProvider.mockReset();
  mockSumQuery.mockReset();
  // Sensible defaults; individual tests override.
  mockRequireOrgAccess.mockReturnValue(true);
  mockHasAccessToPayment.mockResolvedValue(true);
  mockSumQuery.mockResolvedValue([{ total: 0 }]);
});

afterEach(() => vi.clearAllMocks());

function userHeader(user: {
  id: number;
  role: TestRole;
  organizationId: number | null;
  bowlerId?: number | null;
}) {
  return { 'x-test-user': JSON.stringify(user), 'content-type': 'application/json' };
}

const ORG_A_USER = { id: 7, role: 'org_admin' as TestRole, organizationId: 1, bowlerId: null };
const SYSADMIN = { id: 1, role: 'system_admin' as TestRole, organizationId: null, bowlerId: null };
const REGULAR_USER = { id: 9, role: 'user' as TestRole, organizationId: 1, bowlerId: 5 };

const LEAGUE_OK = {
  id: 11,
  organizationId: 1,
  weeklyFee: 2000,
  lineageFee: 1000,
  prizeFundFee: 500,
  seasonStart: null,
  seasonEnd: null,
  locationId: 99,
};

function basePayment(overrides: Record<string, unknown> = {}) {
  return {
    bowlerId: 42,
    leagueId: LEAGUE_OK.id,
    amount: 2000,
    weekOf: '2026-01-05',
    status: 'paid',
    type: 'cash',
    ...overrides,
  };
}

async function post(path: string, body: unknown, user: object = ORG_A_USER) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: userHeader(user as Parameters<typeof userHeader>[0]),
    body: JSON.stringify(body),
  });
}
async function patch(path: string, body: unknown, user: object = ORG_A_USER) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: userHeader(user as Parameters<typeof userHeader>[0]),
    body: JSON.stringify(body),
  });
}
async function del(path: string, user: object = ORG_A_USER) {
  return fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: userHeader(user as Parameters<typeof userHeader>[0]),
  });
}

describe('POST /api/payments', () => {
  it('creates a payment on the happy path → 201', async () => {
    mockStorage.getLeague.mockResolvedValue(LEAGUE_OK);
    mockStorage.createPayment.mockResolvedValue({ id: 555, ...basePayment() });

    const res = await post('/api/payments', basePayment());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id: 555, leagueId: LEAGUE_OK.id });
    // lineage/prize fund pro-rated against weeklyFee.
    const createArg = mockStorage.createPayment.mock.calls[0][0];
    expect(createArg.lineageAmount).toBe(1000); // 2000 * 1000 / 2000
    expect(createArg.prizeFundAmount).toBe(500);
  });

  it('returns 404 when the league does not exist', async () => {
    mockStorage.getLeague.mockResolvedValue(undefined);

    const res = await post('/api/payments', basePayment());
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    expect(mockStorage.createPayment).not.toHaveBeenCalled();
  });

  it('returns 403 when caller has no access to the league org', async () => {
    mockStorage.getLeague.mockResolvedValue(LEAGUE_OK);
    mockRequireOrgAccess.mockReturnValue(false);

    const res = await post('/api/payments', basePayment());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
    expect(mockStorage.createPayment).not.toHaveBeenCalled();
  });

  it('rejects check payments without a check number → 400', async () => {
    mockStorage.getLeague.mockResolvedValue(LEAGUE_OK);
    const res = await post('/api/payments', basePayment({ type: 'check' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(mockStorage.createPayment).not.toHaveBeenCalled();
  });

  it('idempotency dedup returns the existing row with 200 (same league)', async () => {
    mockStorage.getLeague.mockResolvedValue(LEAGUE_OK);
    const existing = { id: 999, leagueId: LEAGUE_OK.id, idempotencyKey: 'k1' };
    mockStorage.getPaymentByIdempotencyKey.mockResolvedValue(existing);

    const res = await post('/api/payments', basePayment({ idempotencyKey: 'k1' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual(existing);
    expect(mockStorage.createPayment).not.toHaveBeenCalled();
  });

  it('idempotency conflict (different league) → 409', async () => {
    mockStorage.getLeague.mockResolvedValue(LEAGUE_OK);
    mockStorage.getPaymentByIdempotencyKey.mockResolvedValue({
      id: 998,
      leagueId: 9999,
      idempotencyKey: 'k1',
    });

    const res = await post('/api/payments', basePayment({ idempotencyKey: 'k1' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT');
    expect(mockStorage.createPayment).not.toHaveBeenCalled();
  });

  it('idempotency race: createPayment 23505 → recovers existing row → 200', async () => {
    mockStorage.getLeague.mockResolvedValue(LEAGUE_OK);
    // First lookup misses (no existing row yet), insert races and loses,
    // second lookup finds the row written by the winner.
    const winner = { id: 1234, leagueId: LEAGUE_OK.id, idempotencyKey: 'race-1' };
    mockStorage.getPaymentByIdempotencyKey
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(winner);
    const dupErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    mockStorage.createPayment.mockRejectedValue(dupErr);

    const res = await post('/api/payments', basePayment({ idempotencyKey: 'race-1' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual(winner);
    expect(mockStorage.getPaymentByIdempotencyKey).toHaveBeenCalledTimes(2);
  });

  it('paid-in-full triggers schedule deactivation + scheduler.removeSchedule', async () => {
    const PIF_LEAGUE = {
      ...LEAGUE_OK,
      seasonStart: '2026-01-01',
      seasonEnd: '2026-02-01', // ~4 full weeks → 4 * 2000 = 8000
      weeklyFee: 2000,
    };
    mockStorage.getLeague.mockResolvedValue(PIF_LEAGUE);
    mockStorage.createPayment.mockResolvedValue({ id: 777, ...basePayment() });
    mockSumQuery.mockResolvedValue([{ total: 8000 }]); // already at full season
    mockStorage.getPaymentSchedule.mockResolvedValue({ id: 333, active: true });
    mockStorage.deactivatePaymentSchedule.mockResolvedValue(undefined);
    mockRemoveSchedule.mockResolvedValue(undefined);

    const res = await post('/api/payments', basePayment());
    expect(res.status).toBe(201);
    expect(mockStorage.deactivatePaymentSchedule).toHaveBeenCalledWith(
      333,
      expect.stringContaining('paid_in_full:payment_id=777'),
    );
    expect(mockRemoveSchedule).toHaveBeenCalledWith(333);
  });
});

describe('PATCH /api/payments/:id', () => {
  it('updates a payment on the happy path → 200', async () => {
    mockStorage.updatePayment.mockResolvedValue({ id: 1, amount: 5000, type: 'cash' });
    const res = await patch('/api/payments/1', { amount: 5000 });
    expect(res.status).toBe(200);
    expect((await res.json()).data.amount).toBe(5000);
    expect(mockHasAccessToPayment).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it('returns 403 for non-admin lacking access', async () => {
    mockHasAccessToPayment.mockResolvedValue(false);
    const res = await patch('/api/payments/1', { amount: 5000 });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
    expect(mockStorage.updatePayment).not.toHaveBeenCalled();
  });

  it('skips access check entirely for system_admin', async () => {
    mockStorage.updatePayment.mockResolvedValue({ id: 1, amount: 5000 });
    const res = await patch('/api/payments/1', { amount: 5000 }, SYSADMIN);
    expect(res.status).toBe(200);
    expect(mockHasAccessToPayment).not.toHaveBeenCalled();
  });

  it('returns 404 when the payment does not exist', async () => {
    mockStorage.updatePayment.mockResolvedValue(undefined);
    const res = await patch('/api/payments/1', { amount: 5000 });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('rejects check type without a check number → 400', async () => {
    const res = await patch('/api/payments/1', { type: 'check' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(mockStorage.updatePayment).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/payments/:id', () => {
  it('deletes a payment on the happy path → 200', async () => {
    mockStorage.getPaymentById.mockResolvedValue({ id: 1, type: 'cash' });
    mockStorage.deletePayment.mockResolvedValue(undefined);
    const res = await del('/api/payments/1');
    expect(res.status).toBe(200);
    expect(mockStorage.deletePayment).toHaveBeenCalledWith(1);
  });

  it('returns 400 for an invalid (non-numeric) id', async () => {
    const res = await del('/api/payments/not-a-number');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_ID');
    expect(mockStorage.getPaymentById).not.toHaveBeenCalled();
  });

  it('returns 404 when the payment does not exist', async () => {
    mockStorage.getPaymentById.mockResolvedValue(undefined);
    const res = await del('/api/payments/1');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('blocks non-admin users from deleting card payments → 403', async () => {
    mockStorage.getPaymentById.mockResolvedValue({ id: 1, type: 'credit_card' });
    const res = await del('/api/payments/1', REGULAR_USER);
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/admins/i);
    expect(mockStorage.deletePayment).not.toHaveBeenCalled();
  });

  it('returns 403 for non-admin lacking access', async () => {
    mockStorage.getPaymentById.mockResolvedValue({ id: 1, type: 'cash' });
    mockHasAccessToPayment.mockResolvedValue(false);
    const res = await del('/api/payments/1');
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
    expect(mockStorage.deletePayment).not.toHaveBeenCalled();
  });
});

describe('POST /api/payments/:id/refund', () => {
  const cardPayment = {
    id: 50,
    type: 'credit_card',
    status: 'paid',
    amount: 2500,
    leagueId: LEAGUE_OK.id,
    cardpointeRetref: 'RETREF-XYZ',
    providerPaymentId: null,
  };

  it('happy path: delegates to provider then refunds in storage → 200', async () => {
    mockStorage.getPaymentById.mockResolvedValue(cardPayment);
    mockStorage.getLeague.mockResolvedValue(LEAGUE_OK);
    const refundPayment = vi.fn().mockResolvedValue({ refundId: 'RF_1' });
    mockGetPaymentProvider.mockResolvedValue({ refundPayment });
    mockStorage.refundPayment.mockResolvedValue({ ...cardPayment, status: 'refunded' });

    const res = await post('/api/payments/50/refund', { reason: 'cust' }, ORG_A_USER);
    expect(res.status).toBe(200);
    expect(mockGetPaymentProvider).toHaveBeenCalledWith(LEAGUE_OK.locationId);
    expect(refundPayment).toHaveBeenCalledWith('RETREF-XYZ', 2500, 'cust');
    expect(mockStorage.refundPayment).toHaveBeenCalledWith(50, 'RF_1', 'cust');
    expect((await res.json()).data.status).toBe('refunded');
  });

  it('rejects non-admins → 403', async () => {
    const res = await post('/api/payments/50/refund', {}, REGULAR_USER);
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/admins/i);
    expect(mockStorage.getPaymentById).not.toHaveBeenCalled();
  });

  it('returns 400 when the payment is already refunded', async () => {
    mockStorage.getPaymentById.mockResolvedValue({ ...cardPayment, status: 'refunded' });
    const res = await post('/api/payments/50/refund', {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('ALREADY_REFUNDED');
  });

  it('returns 400 when the payment status is not paid', async () => {
    mockStorage.getPaymentById.mockResolvedValue({ ...cardPayment, status: 'pending' });
    const res = await post('/api/payments/50/refund', {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_STATUS');
  });

  it('returns 400 for non-card payment types (e.g. cash)', async () => {
    mockStorage.getPaymentById.mockResolvedValue({ ...cardPayment, type: 'cash' });
    const res = await post('/api/payments/50/refund', {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_TYPE');
  });

  it('returns 422 when the payment provider is not configured', async () => {
    mockStorage.getPaymentById.mockResolvedValue(cardPayment);
    mockStorage.getLeague.mockResolvedValue(LEAGUE_OK);
    mockGetPaymentProvider.mockRejectedValue(
      new FakeProviderNotConfiguredError('no provider'),
    );

    const res = await post('/api/payments/50/refund', {});
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
  });

  it('returns 400 with INVALID_ID for a non-numeric :id', async () => {
    const res = await post('/api/payments/not-a-number/refund', {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_ID');
  });
});
