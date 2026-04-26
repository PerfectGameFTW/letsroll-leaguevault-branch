/**
 * Task #503 — verifies that POST /api/payments-provider/payments
 * persists Square's hosted-receipt fields and flags charges that ran
 * without a buyer email (no auto-receipt was sent in that case).
 *
 * Coverage:
 *  - bowler with email on file → receiptUrl/receiptNumber persisted,
 *    receiptEmailMissing=false, no warn log.
 *  - bowler with no email + no override → receiptEmailMissing=true,
 *    log.warn fires.
 *  - bowler with no email + request body buyerEmail override →
 *    receiptEmailMissing=false (Square got the email).
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

const mockProvider = {
  providerName: 'square' as const,
  processPayment: vi.fn(),
  createOrderWithPayment: vi.fn(),
  getPayment: vi.fn(),
  saveCardOnFile: vi.fn(),
  validateCardId: vi.fn().mockReturnValue(false),
};
const mockGetPaymentProvider = vi.fn();
class FakeProviderNotConfigured extends Error {
  constructor(m: string) { super(m); this.name = 'ProviderNotConfiguredError'; }
}
vi.mock('../../server/services/payment-provider-factory', () => ({
  getPaymentProvider: (...a: unknown[]) => mockGetPaymentProvider(...a),
  ProviderNotConfiguredError: FakeProviderNotConfigured,
}));

vi.mock('../../server/services/payment-execution', () => ({
  computePaymentSplit: () => ({ lineageAmount: 0, prizeFundAmount: 0 }),
  buildLineItems: () => [],
}));

vi.mock('../../server/services/payment-utils', () => ({
  getProviderCustomerId: () => 'cust_123',
  persistCardpointeProfile: vi.fn(),
}));

vi.mock('../../server/routes/payments-provider/shared', () => ({
  getProviderForLeague: vi.fn(),
}));

const warnSpy = vi.fn();
const fakeLogger = {
  info: vi.fn(),
  warn: (...a: unknown[]) => warnSpy(...a),
  error: vi.fn(),
  debug: vi.fn(),
};
vi.mock('../../server/logger', () => ({
  logger: fakeLogger,
  createLogger: () => fakeLogger,
}));

const chargesRouter = (await import('../../server/routes/payments-provider/charges')).default;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const raw = req.header('x-test-user');
    if (raw) (req as unknown as { user: unknown }).user = JSON.parse(raw);
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
  warnSpy.mockReset();
  for (const fn of [mockProvider.processPayment, mockProvider.createOrderWithPayment, mockProvider.getPayment, mockProvider.saveCardOnFile]) {
    (fn as ReturnType<typeof vi.fn>).mockReset();
  }

  mockHasAccessToLeague.mockResolvedValue(true);
  mockHasAccessToBowler.mockResolvedValue(true);
  mockGetPaymentProvider.mockResolvedValue(mockProvider);
  mockStorage.getLeague.mockResolvedValue({
    id: 11, organizationId: 1, weeklyFee: 2000, lineageFee: 0, prizeFundFee: 0,
    seasonStart: '2026-01-01', seasonEnd: '2026-04-01', totalBowlingWeeks: 12,
    cancelledDates: [], locationId: 99,
  });
  mockStorage.getPayments.mockResolvedValue([]);
  mockStorage.getPaymentByIdempotencyKey.mockResolvedValue(null);
  mockStorage.createPayment.mockImplementation(async (input: Record<string, unknown>) => ({
    id: 1234, ...input,
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

describe('POST /api/payments-provider/payments — receipt persistence (Task #503)', () => {
  it('persists receiptUrl/receiptNumber and clears receiptEmailMissing when bowler has email', async () => {
    mockStorage.getBowler.mockResolvedValue({
      id: 42, name: 'Pat', email: 'pat@example.com', squareCustomerId: 'cust_123',
    });
    mockProvider.processPayment.mockResolvedValue({
      id: 'sq_pay_1',
      status: 'COMPLETED',
      receiptUrl: 'https://squareup.com/receipt/preview/sq_pay_1',
      receiptNumber: 'XYZ-001',
      providerRef: {},
    });

    const res = await postCharge({
      sourceId: 'cnon:tok_abc', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
    });

    expect(res.status).toBe(200);
    expect(mockStorage.createPayment).toHaveBeenCalledOnce();
    const insert = mockStorage.createPayment.mock.calls[0][0];
    expect(insert).toMatchObject({
      providerPaymentId: 'sq_pay_1',
      receiptUrl: 'https://squareup.com/receipt/preview/sq_pay_1',
      receiptNumber: 'XYZ-001',
      receiptEmailMissing: false,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('flags receiptEmailMissing and warns when bowler has no email and no override', async () => {
    mockStorage.getBowler.mockResolvedValue({
      id: 42, name: 'Pat', email: null, squareCustomerId: 'cust_123',
    });
    mockProvider.processPayment.mockResolvedValue({
      id: 'sq_pay_2', status: 'COMPLETED',
      receiptUrl: 'https://squareup.com/receipt/preview/sq_pay_2',
      receiptNumber: 'XYZ-002',
      providerRef: {},
    });

    const res = await postCharge({
      sourceId: 'cnon:tok_def', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
    });

    expect(res.status).toBe(200);
    const insert = mockStorage.createPayment.mock.calls[0][0];
    expect(insert.receiptEmailMissing).toBe(true);
    expect(insert.receiptUrl).toBe('https://squareup.com/receipt/preview/sq_pay_2');
    expect(warnSpy).toHaveBeenCalled();
    const warnMsg = String(warnSpy.mock.calls[0][0] ?? '');
    expect(warnMsg).toMatch(/without buyer email/i);

    // The provider call itself must have received `undefined` so Square
    // doesn't try to email a blank string.
    const callArgs = mockProvider.processPayment.mock.calls[0];
    expect(callArgs[4]).toBeUndefined();
  });

  it('clears receiptEmailMissing when request body provides a buyerEmail override', async () => {
    mockStorage.getBowler.mockResolvedValue({
      id: 42, name: 'Pat', email: null, squareCustomerId: 'cust_123',
    });
    mockProvider.processPayment.mockResolvedValue({
      id: 'sq_pay_3', status: 'COMPLETED',
      receiptUrl: 'https://squareup.com/receipt/preview/sq_pay_3',
      receiptNumber: 'XYZ-003',
      providerRef: {},
    });

    const res = await postCharge({
      sourceId: 'cnon:tok_ghi', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
      buyerEmail: '  override@example.com  ',
    });

    expect(res.status).toBe(200);
    const insert = mockStorage.createPayment.mock.calls[0][0];
    expect(insert.receiptEmailMissing).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();

    // The trimmed override email must be threaded into the provider call.
    const callArgs = mockProvider.processPayment.mock.calls[0];
    expect(callArgs[4]).toBe('override@example.com');
  });
});
