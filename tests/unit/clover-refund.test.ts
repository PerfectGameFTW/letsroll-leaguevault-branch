/**
 * Task #574 — Clover parity for the refund flow.
 *
 * Mirrors the Square coverage in
 *   tests/unit/payment-refunds-receipt-dependency.test.ts
 * but for type='clover' rows and the Clover payment provider.
 *
 * Behavior under test on POST /api/payments/:id/refund:
 *  - For a Clover charge, the route prefers `payment.cloverChargeId`
 *    when picking the provider reference (see payment-refunds.ts:
 *    `payment.cloverChargeId || payment.providerPaymentId`), and
 *    forwards (chargeId, amount, reason) to provider.refundPayment.
 *  - The refund id returned by the provider is persisted via
 *    storage.refundPayment.
 *  - When `cloverChargeId` is missing, the route falls back to
 *    `providerPaymentId` (defends against legacy rows written before
 *    the dedicated column existed).
 */
import {
  afterAll, afterEach, beforeAll, beforeEach,
  describe, expect, it, vi,
} from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const mockStorage = {
  getPaymentById: vi.fn(),
  getLeague: vi.fn(),
  refundPayment: vi.fn(),
};
vi.mock('../../server/storage', () => ({ storage: mockStorage }));

const mockHasAccessToPayment = vi.fn();
vi.mock('../../server/utils/access-control', () => ({
  hasAccessToPayment: (...a: unknown[]) => mockHasAccessToPayment(...a),
}));

vi.mock('../../server/middleware/rate-limit', () => ({
  paymentWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockProvider = {
  providerName: 'clover' as const,
  refundPayment: vi.fn(),
};
const mockGetPaymentProvider = vi.fn();
class FakeProviderNotConfigured extends Error {
  constructor(m: string) { super(m); this.name = 'ProviderNotConfiguredError'; }
}
vi.mock('../../server/services/payment-provider-factory', () => ({
  getPaymentProvider: (...a: unknown[]) => mockGetPaymentProvider(...a),
  ProviderNotConfiguredError: FakeProviderNotConfigured,
}));

// eslint-disable-next-line local/factory-must-use-schema -- mocked logger, not a schema row
const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../server/logger', () => ({ logger: fakeLogger, createLogger: () => fakeLogger }));

const refundsRouter = (await import('../../server/routes/payments/payment-refunds')).default;

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
  app.use('/api/payments', refundsRouter);
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
  mockHasAccessToPayment.mockReset();
  mockGetPaymentProvider.mockReset();
  (mockProvider.refundPayment as ReturnType<typeof vi.fn>).mockReset();

  mockHasAccessToPayment.mockResolvedValue(true);
  mockGetPaymentProvider.mockResolvedValue(mockProvider);
  mockStorage.getLeague.mockResolvedValue({ id: 11, locationId: 99 });
  mockProvider.refundPayment.mockResolvedValue({ refundId: 'cv_rfnd_1', status: 'REFUNDED' });
});

afterEach(() => vi.clearAllMocks());

const ADMIN = { id: 1, role: 'org_admin', organizationId: 1, bowlerId: null };

async function postRefund(id: number, body: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/api/payments/${id}/refund`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test-user': JSON.stringify(ADMIN),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/payments/:id/refund — Clover parity (Task #574)', () => {
  it('refunds a Clover charge using cloverChargeId and persists the provider refund id', async () => {
    mockStorage.getPaymentById.mockResolvedValue({
      id: 555, status: 'paid', type: 'clover', leagueId: 11, amount: 2000,
      providerPaymentId: 'cv_pay_555',
      cloverChargeId: 'cv_pay_555',
      receiptEmailMissing: false, receiptUrl: null,
    });
    mockStorage.refundPayment.mockResolvedValue({ id: 555, status: 'refunded', refundId: 'cv_rfnd_1' });

    const res = await postRefund(555, { reason: 'Customer request' });

    expect(res.status).toBe(200);
    expect(mockGetPaymentProvider).toHaveBeenCalledWith(99);
    expect(mockProvider.refundPayment).toHaveBeenCalledTimes(1);
    expect(mockProvider.refundPayment).toHaveBeenCalledWith('cv_pay_555', 2000, 'Customer request');
    // Refund route signature is (chargeId, amount, reason) — same
    // shape Square uses, no buyer-email parameter.
    expect(mockProvider.refundPayment.mock.calls[0]).toHaveLength(3);
    expect(mockStorage.refundPayment).toHaveBeenCalledWith(555, 'cv_rfnd_1', 'Customer request');
  });

  it('falls back to providerPaymentId when a legacy Clover row has no cloverChargeId', async () => {
    mockStorage.getPaymentById.mockResolvedValue({
      id: 556, status: 'paid', type: 'clover', leagueId: 11, amount: 1500,
      providerPaymentId: 'cv_pay_legacy',
      // cloverChargeId omitted on purpose — older rows didn't set it.
      cloverChargeId: null,
      receiptEmailMissing: false,
    });
    mockStorage.refundPayment.mockResolvedValue({ id: 556, status: 'refunded', refundId: 'cv_rfnd_2' });
    mockProvider.refundPayment.mockResolvedValue({ refundId: 'cv_rfnd_2', status: 'REFUNDED' });

    const res = await postRefund(556, { reason: 'Duplicate charge' });

    expect(res.status).toBe(200);
    expect(mockProvider.refundPayment).toHaveBeenCalledWith('cv_pay_legacy', 1500, 'Duplicate charge');
    expect(mockStorage.refundPayment).toHaveBeenCalledWith(556, 'cv_rfnd_2', 'Duplicate charge');
  });

  it('rejects re-refunding a Clover charge that has already been refunded', async () => {
    mockStorage.getPaymentById.mockResolvedValue({
      id: 557, status: 'refunded', type: 'clover', leagueId: 11, amount: 2000,
      providerPaymentId: 'cv_pay_557', cloverChargeId: 'cv_pay_557',
    });

    const res = await postRefund(557, { reason: 'Oops' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('ALREADY_REFUNDED');
    expect(mockProvider.refundPayment).not.toHaveBeenCalled();
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
  });
});
