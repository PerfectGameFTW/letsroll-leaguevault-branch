/**
 * Task #574 — Clover parity for the saved-card flow.
 *
 * "Returning customer paying with a saved card" exercises two halves of
 * the vault lifecycle that mirror Square's behavior:
 *
 *  1. First-time charge with `storeCard=true`: the route forwards the
 *     one-time `clv_…` token to processPayment, then calls
 *     saveCardOnFile against the bowler's Clover customer id and
 *     stamps the saved-source id on the payment schedule. This is the
 *     setup step that turns a one-shot card into a returning-customer
 *     vault entry.
 *  2. Subsequent charge with the saved `src_…` source id (returning
 *     customer): the route still forwards the customer id and source,
 *     but skips the save-card round-trip because validateCardId('src_…')
 *     returns true (a vaulted source doesn't need re-vaulting).
 *
 * Mirrors the wiring covered for Square in
 *   tests/unit/charges-receipt-persistence.test.ts and
 *   tests/unit/charges-buyer-email-enforcement.test.ts.
 */
import {
  afterAll, afterEach, beforeAll, beforeEach,
  describe, expect, it, vi,
} from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const mockStorage = {
  getLeague: vi.fn(),
  getBowler: vi.fn(),
  getPayments: vi.fn(),
  getPaymentByIdempotencyKey: vi.fn(),
  createPayment: vi.fn(),
  updatePaymentScheduleCard: vi.fn(),
  updateBowler: vi.fn(),
};
vi.mock('../../server/storage', () => ({ storage: mockStorage }));

const mockHasAccessToLeague = vi.fn();
const mockHasAccessToBowler = vi.fn();
vi.mock('../../server/utils/access-control', () => ({
  hasAccessToLeague: (...a: unknown[]) => mockHasAccessToLeague(...a),
  hasAccessToBowler: (...a: unknown[]) => mockHasAccessToBowler(...a),
}));

vi.mock('../../server/middleware/rate-limit', () => ({
  paymentLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  paymentWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockCloverProvider = {
  providerName: 'clover' as const,
  locationId: 99,
  processPayment: vi.fn(),
  createOrderWithPayment: vi.fn(),
  getPayment: vi.fn(),
  saveCardOnFile: vi.fn(),
  // Real Clover provider rule: ids beginning with `src_` are vaulted
  // sources and don't need re-saving. We mirror that exact rule so the
  // route's save-card branch is skipped on the returning-customer path.
  validateCardId: vi.fn((id: string | null) => !!id && /^src_/.test(id)),
};
const mockGetPaymentProvider = vi.fn();
class FakeProviderNotConfigured extends Error {
  constructor(m: string) { super(m); this.name = 'ProviderNotConfiguredError'; }
}
class FakePaymentProviderError extends Error {
  code: string;
  userMessage: string;
  detail?: string;
  constructor(message: string, code: string, detail?: string) {
    super(message);
    this.name = 'PaymentProviderError';
    this.code = code;
    this.userMessage = message;
    this.detail = detail;
  }
}
vi.mock('../../server/services/payment-provider-factory', () => ({
  getPaymentProvider: (...a: unknown[]) => mockGetPaymentProvider(...a),
  ProviderNotConfiguredError: FakeProviderNotConfigured,
  PaymentProviderError: FakePaymentProviderError,
  sanitizePaymentUserMessage: (m: string) => m,
  GENERIC_PAYMENT_USER_MESSAGE: 'Something went wrong with your payment.',
}));

vi.mock('../../server/services/payment-execution', () => ({
  computePaymentSplit: () => ({ lineageAmount: 0, prizeFundAmount: 0 }),
  buildLineItems: () => [],
}));

const mockPersistCloverCustomer = vi.fn();
const mockEnsureProviderCustomer = vi.fn();
vi.mock('../../server/services/payment-utils', () => ({
  getProviderCustomerId: (bowler: { cloverCustomerId?: string }) =>
    bowler.cloverCustomerId,
  persistCloverCustomer: (...a: unknown[]) => mockPersistCloverCustomer(...a),
  ensureProviderCustomer: (...a: unknown[]) => mockEnsureProviderCustomer(...a),
}));

vi.mock('../../server/routes/payments-provider/shared', () => ({
  getProviderForLeague: vi.fn(),
}));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../server/logger', () => ({ logger: fakeLogger, createLogger: () => fakeLogger }));

const chargesRouter = (await import('../../server/routes/payments-provider/charges')).default;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const raw = req.header('x-test-user');
    if (raw) Object.assign(req, { user: JSON.parse(raw) });
    next();
  });
  app.use('/api/payments-provider', chargesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  for (const fn of Object.values(mockStorage)) (fn as ReturnType<typeof vi.fn>).mockReset();
  mockHasAccessToLeague.mockReset();
  mockHasAccessToBowler.mockReset();
  mockGetPaymentProvider.mockReset();
  mockPersistCloverCustomer.mockReset();
  mockEnsureProviderCustomer.mockReset();
  for (const fn of [
    mockCloverProvider.processPayment,
    mockCloverProvider.createOrderWithPayment,
    mockCloverProvider.saveCardOnFile,
  ]) {
    (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  mockCloverProvider.validateCardId.mockClear();

  mockHasAccessToLeague.mockResolvedValue(true);
  mockHasAccessToBowler.mockResolvedValue(true);
  mockGetPaymentProvider.mockResolvedValue(mockCloverProvider);
  mockStorage.getLeague.mockResolvedValue({
    id: 11, organizationId: 1, weeklyFee: 2000, lineageFee: 0, prizeFundFee: 0,
    seasonStart: '2026-01-01', seasonEnd: '2026-04-01', totalBowlingWeeks: 12,
    cancelledDates: [], locationId: 99,
  });
  mockStorage.getPayments.mockResolvedValue([]);
  mockStorage.getPaymentByIdempotencyKey.mockResolvedValue(null);
  mockStorage.createPayment.mockImplementation(async (input: Record<string, unknown>) => ({
    id: 9001, ...input,
  }));
});

afterEach(() => vi.clearAllMocks());

const ADMIN = { id: 1, role: 'org_admin', organizationId: 1, bowlerId: null };

async function postCharge(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/payments-provider/payments`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test-user': JSON.stringify(ADMIN),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/payments-provider/payments — Clover saved-card lifecycle (Task #574)', () => {
  it('first-time charge with storeCard=true vaults the card and stamps the schedule', async () => {
    mockStorage.getBowler.mockResolvedValue({
      id: 42, name: 'Pat', email: 'pat@example.com', cloverCustomerId: 'cv_cust_1',
    });
    mockCloverProvider.processPayment.mockResolvedValue({
      id: 'cv_pay_first',
      status: 'COMPLETED',
      card: { last4: '4242', brand: 'VISA' },
      providerRef: { cloverChargeId: 'cv_pay_first' },
    });
    mockCloverProvider.saveCardOnFile.mockResolvedValue({
      id: 'src_saved_1', last4: '4242', brand: 'VISA',
    });

    const res = await postCharge({
      sourceId: 'clv_tok_one_shot', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: true,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.savedCardId).toBe('src_saved_1');

    // Charge happens first, with the customer id forwarded.
    expect(mockCloverProvider.processPayment).toHaveBeenCalledTimes(1);
    expect(mockCloverProvider.processPayment.mock.calls[0][3]).toBe('cv_cust_1');

    // Then the route vaults the one-time token because validateCardId
    // returned false for `clv_…` (not a saved-source prefix).
    expect(mockCloverProvider.validateCardId).toHaveBeenCalledWith('clv_tok_one_shot');
    expect(mockCloverProvider.saveCardOnFile).toHaveBeenCalledWith('clv_tok_one_shot', 'cv_cust_1');

    // Saved-source id is written to the bowler's payment schedule and
    // the customer id is persisted on the bowler row for future reuse.
    expect(mockStorage.updatePaymentScheduleCard).toHaveBeenCalledWith(42, 11, 'src_saved_1');
    expect(mockPersistCloverCustomer).toHaveBeenCalledWith(mockCloverProvider, 'cv_cust_1', 42);
  });

  it('returning-customer charge with a saved src_ token does NOT re-vault the card', async () => {
    mockStorage.getBowler.mockResolvedValue({
      id: 42, name: 'Pat', email: 'pat@example.com', cloverCustomerId: 'cv_cust_1',
    });
    mockCloverProvider.processPayment.mockResolvedValue({
      id: 'cv_pay_return',
      status: 'COMPLETED',
      card: { last4: '4242', brand: 'VISA' },
      providerRef: { cloverChargeId: 'cv_pay_return' },
    });

    const res = await postCharge({
      // Same `src_…` shape that was returned by saveCardOnFile in
      // the previous test — this is the "returning customer" replay.
      sourceId: 'src_saved_1', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: true,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.savedCardId).toBeNull();

    expect(mockCloverProvider.processPayment).toHaveBeenCalledTimes(1);
    expect(mockCloverProvider.processPayment.mock.calls[0][0]).toBe('src_saved_1');
    expect(mockCloverProvider.processPayment.mock.calls[0][3]).toBe('cv_cust_1');

    // validateCardId('src_saved_1') === true → save branch skipped.
    expect(mockCloverProvider.validateCardId).toHaveBeenCalledWith('src_saved_1');
    expect(mockCloverProvider.saveCardOnFile).not.toHaveBeenCalled();
    expect(mockStorage.updatePaymentScheduleCard).not.toHaveBeenCalled();
    expect(mockPersistCloverCustomer).not.toHaveBeenCalled();

    // The charge itself is still recorded normally.
    expect(mockStorage.createPayment).toHaveBeenCalledOnce();
    expect(mockStorage.createPayment.mock.calls[0][0]).toMatchObject({
      type: 'clover',
      providerPaymentId: 'cv_pay_return',
      cloverChargeId: 'cv_pay_return',
    });
  });

  it('charge succeeds even when the post-charge save-card round-trip throws (failure is non-fatal)', async () => {
    mockStorage.getBowler.mockResolvedValue({
      id: 42, name: 'Pat', email: 'pat@example.com', cloverCustomerId: 'cv_cust_1',
    });
    mockCloverProvider.processPayment.mockResolvedValue({
      id: 'cv_pay_charge_only',
      status: 'COMPLETED',
      card: { last4: '4242', brand: 'VISA' },
      providerRef: { cloverChargeId: 'cv_pay_charge_only' },
    });
    mockCloverProvider.saveCardOnFile.mockRejectedValue(new Error('vault outage'));

    const res = await postCharge({
      sourceId: 'clv_tok_one_shot', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: true,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Save failed → no saved-card id surfaced and no schedule update,
    // but the underlying charge is still persisted.
    expect(body.savedCardId).toBeNull();
    expect(mockStorage.updatePaymentScheduleCard).not.toHaveBeenCalled();
    expect(mockStorage.createPayment).toHaveBeenCalledOnce();
    expect(mockStorage.createPayment.mock.calls[0][0]).toMatchObject({
      providerPaymentId: 'cv_pay_charge_only',
      cloverChargeId: 'cv_pay_charge_only',
      type: 'clover',
    });
  });
});
