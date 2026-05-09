/**
 * Task #574 — Clover parity for the successful-charge flow.
 *
 * Mirrors the Square coverage in
 *   tests/unit/charges-receipt-persistence.test.ts
 * but for the Clover payment provider, so regressions in the new
 * provider get caught the same way Square's do.
 *
 * Square has hosted receipts and so persists `receiptUrl` /
 * `receiptNumber` on success. Clover Ecommerce has no hosted-receipt
 * concept — the provider returns no receipt fields — so the parallel
 * here is "the row is inserted with type='clover', the cloverChargeId
 * lifted from providerRef is persisted, and the route does NOT trigger
 * the Square-only buyer-email enforcement".
 *
 * Coverage:
 *  - Successful Clover charge → 200, type='clover', cloverChargeId
 *    persisted from providerRef, customerId threaded into the
 *    provider call.
 *  - Successful Clover charge with NO buyer email anywhere → 200
 *    (Clover has no auto-receipt, so the BUYER_EMAIL_REQUIRED guard
 *    never trips).
 *  - Idempotent resubmit (same sourceId+bowler+league+amount) → the
 *    deduplicated branch returns without re-charging.
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
  // Default: incoming sourceId is a one-time token (clv_...), not a
  // saved-source reference.
  validateCardId: vi.fn().mockReturnValue(false),
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

vi.mock('../../server/services/payment-utils', () => ({
  getProviderCustomerId: (bowler: { cloverCustomerId?: string }) =>
    bowler.cloverCustomerId,
  persistCloverCustomer: vi.fn(),
  ensureProviderCustomer: vi.fn(),
}));

vi.mock('../../server/routes/payments-provider/shared', () => ({
  getProviderForLeague: vi.fn(),
}));

// eslint-disable-next-line local/factory-must-use-schema -- mocked logger, not a schema row
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
  for (const fn of [
    mockCloverProvider.processPayment,
    mockCloverProvider.createOrderWithPayment,
    mockCloverProvider.getPayment,
    mockCloverProvider.saveCardOnFile,
  ]) {
    (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  mockCloverProvider.validateCardId.mockReset().mockReturnValue(false);

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
    id: 4242, ...input,
  }));
});

afterEach(() => vi.clearAllMocks());

// provider-parity tests run as the bowler
// themselves (self-pay), not as an admin acting on behalf. The
// admin-fallback path no longer forwards the recipient's vaulted
// customer id — the dedicated /api/payments admin-record endpoint
// owns that flow.
const USER_SELF = { id: 1, role: 'bowler', organizationId: 1, bowlerId: 42 };

async function postCharge(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/payments-provider/payments`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test-user': JSON.stringify(USER_SELF),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/payments-provider/payments — Clover charge parity (Task #574)', () => {
  it('persists a Clover charge with type=clover and lifts cloverChargeId from providerRef', async () => {
    mockStorage.getBowler.mockResolvedValue({
      id: 42, organizationId: 1, name: 'Pat', email: 'pat@example.com', cloverCustomerId: 'cv_cust_1',
    });
    mockCloverProvider.processPayment.mockResolvedValue({
      id: 'cv_pay_1',
      status: 'COMPLETED',
      card: { last4: '4242', brand: 'VISA' },
      providerRef: { cloverChargeId: 'cv_pay_1' },
    });

    const res = await postCharge({
      sourceId: 'clv_tok_abc', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
    });

    expect(res.status).toBe(200);
    expect(mockCloverProvider.processPayment).toHaveBeenCalledTimes(1);
    const callArgs = mockCloverProvider.processPayment.mock.calls[0];
    // (sourceId, amount, storeCard, customerId, buyerEmail, idempotencyKey)
    expect(callArgs[0]).toBe('clv_tok_abc');
    expect(callArgs[1]).toBe(2000);
    expect(callArgs[3]).toBe('cv_cust_1');
    expect(callArgs[4]).toBe('pat@example.com');

    expect(mockStorage.createPayment).toHaveBeenCalledOnce();
    const insert = mockStorage.createPayment.mock.calls[0][0];
    expect(insert).toMatchObject({
      providerPaymentId: 'cv_pay_1',
      cloverChargeId: 'cv_pay_1',
      type: 'clover',
      status: 'paid',
      amount: 2000,
      bowlerId: 42,
      leagueId: 11,
      // Clover has no hosted-receipt, so these stay undefined and the
      // route writes receiptEmailMissing=false on the interactive path.
      receiptEmailMissing: false,
    });
    expect(insert.receiptUrl).toBeUndefined();
    expect(insert.receiptNumber).toBeUndefined();
  });

  it('processes a Clover charge with NO email anywhere — buyer-email guard is Square-only', async () => {
    mockStorage.getBowler.mockResolvedValue({
      id: 42, organizationId: 1, name: 'Pat', email: null, cloverCustomerId: 'cv_cust_1',
    });
    mockCloverProvider.processPayment.mockResolvedValue({
      id: 'cv_pay_2',
      status: 'COMPLETED',
      card: { last4: '4242', brand: 'VISA' },
      providerRef: { cloverChargeId: 'cv_pay_2' },
    });

    const res = await postCharge({
      sourceId: 'clv_tok_def', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
    });

    expect(res.status).toBe(200);
    expect(mockCloverProvider.processPayment).toHaveBeenCalledOnce();
    // No buyer email was supplied — the provider sees `undefined`.
    expect(mockCloverProvider.processPayment.mock.calls[0][4]).toBeUndefined();
    expect(mockStorage.createPayment).toHaveBeenCalledOnce();
    expect(mockStorage.createPayment.mock.calls[0][0]).toMatchObject({ type: 'clover' });
  });

  it('deduplicates a re-submitted Clover charge instead of double-charging', async () => {
    mockStorage.getBowler.mockResolvedValue({
      id: 42, organizationId: 1, name: 'Pat', email: 'pat@example.com', cloverCustomerId: 'cv_cust_1',
    });
    // The idempotency lookup finds an existing row → the route should
    // short-circuit and return the previously-stored ids without
    // calling the provider again.
    mockStorage.getPaymentByIdempotencyKey.mockResolvedValue({
      id: 7777, providerPaymentId: 'cv_pay_prev', status: 'paid',
    });

    const res = await postCharge({
      sourceId: 'clv_tok_repeat', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      dbPaymentId: 7777,
      id: 'cv_pay_prev',
      status: 'COMPLETED',
      deduplicated: true,
    });
    expect(mockCloverProvider.processPayment).not.toHaveBeenCalled();
    expect(mockCloverProvider.createOrderWithPayment).not.toHaveBeenCalled();
    expect(mockStorage.createPayment).not.toHaveBeenCalled();
  });
});
