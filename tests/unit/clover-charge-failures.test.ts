/**
 * Task #578 — Clover charge failure-path coverage.
 *
 * Sibling to tests/unit/clover-charge.test.ts (Task #574), which only
 * covers the success/dedup paths. This file pins the failure paths so
 * a regression in user-facing error messaging or in the
 * CloverApiError → PaymentProviderError mapping gets caught early.
 *
 * Two layers are exercised:
 *
 *   1. POST /api/payments-provider/payments (route layer):
 *      - Card decline surfaces a sanitized user-facing message and
 *        the typed error code, and does NOT persist a payment row.
 *      - A network/timeout-style failure from the provider is mapped
 *        through PaymentProviderError + sanitizePaymentUserMessage
 *        and stays human-readable.
 *      - A PaymentProviderError whose `userMessage` accidentally
 *        carries JSON / a multi-line stack-trace fragment is
 *        scrubbed by sanitizePaymentUserMessage on the way out.
 *      - A bare `Error` (forgot the typed wrapper) returns the
 *        generic safe message + the generic PAYMENT_ERROR code.
 *      - Every failure path fires log.error so on-call has signal.
 *
 *   2. CloverPaymentProvider.processPayment (provider layer):
 *      - 402 from Clover → PAYMENT_DECLINED.
 *      - 401/403 from Clover → SYSTEM_ERROR.
 *      - Other 4xx from Clover → INVALID_REQUEST.
 *      - Transport failures (e.g. fetch TypeError) → PAYMENT_FAILED
 *        with the original error message kept on `detail` for logs.
 *      - The raw upstream body is kept on `detail` (server-side
 *        only) and never copied into `userMessage`.
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
  getLocationCloverConfig: vi.fn(),
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

// Use the REAL PaymentProviderError / sanitizePaymentUserMessage /
// GENERIC_PAYMENT_USER_MESSAGE / ProviderNotConfiguredError so the
// route's `instanceof PaymentProviderError` branch and the sanitizer
// behave exactly as in production. Only `getPaymentProvider` is faked
// out so the route resolves to our mock provider stub.
const mockGetPaymentProvider = vi.fn();
vi.mock('../../server/services/payment-provider-factory', async () => {
  const actual = await vi.importActual<
    typeof import('../../server/services/payment-provider-factory')
  >('../../server/services/payment-provider-factory');
  return {
    ...actual,
    getPaymentProvider: (...a: unknown[]) => mockGetPaymentProvider(...a),
  };
});

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

// Mock the low-level Clover SDK so the provider-layer suite below
// can simulate API failures without making real HTTP calls. The
// route-layer suite uses a fully-stubbed provider object instead, so
// it never reaches these.
const mockCreateCharge = vi.fn();
vi.mock('../../server/services/clover', async () => {
  const actual = await vi.importActual<typeof import('../../server/services/clover')>(
    '../../server/services/clover',
  );
  return {
    ...actual,
    createCharge: (...a: unknown[]) => mockCreateCharge(...a),
  };
});

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../server/logger', () => ({ logger: fakeLogger, createLogger: () => fakeLogger }));

const chargesRouter = (await import('../../server/routes/payments-provider/charges')).default;
const {
  PaymentProviderError,
  GENERIC_PAYMENT_USER_MESSAGE,
} = await import('../../server/services/payment-provider-factory');
const { CloverPaymentProvider } = await import('../../server/services/clover-provider');
const { CloverApiError } = await import('../../server/services/clover');

const mockCloverProvider = {
  providerName: 'clover' as const,
  locationId: 99,
  processPayment: vi.fn(),
  createOrderWithPayment: vi.fn(),
  getPayment: vi.fn(),
  saveCardOnFile: vi.fn(),
  validateCardId: vi.fn().mockReturnValue(false),
};

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
  mockCreateCharge.mockReset();
  for (const fn of [
    mockCloverProvider.processPayment,
    mockCloverProvider.createOrderWithPayment,
    mockCloverProvider.getPayment,
    mockCloverProvider.saveCardOnFile,
  ]) {
    (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  mockCloverProvider.validateCardId.mockReset().mockReturnValue(false);
  fakeLogger.info.mockReset();
  fakeLogger.warn.mockReset();
  fakeLogger.error.mockReset();
  fakeLogger.debug.mockReset();

  mockHasAccessToLeague.mockResolvedValue(true);
  mockHasAccessToBowler.mockResolvedValue(true);
  mockGetPaymentProvider.mockResolvedValue(mockCloverProvider);
  mockStorage.getLeague.mockResolvedValue({
    id: 11, organizationId: 1, weeklyFee: 2000, lineageFee: 0, prizeFundFee: 0,
    seasonStart: '2026-01-01', seasonEnd: '2026-04-01', totalBowlingWeeks: 12,
    cancelledDates: [], locationId: 99,
  });
  mockStorage.getBowler.mockResolvedValue({
    id: 42, name: 'Pat', email: 'pat@example.com', cloverCustomerId: 'cv_cust_1',
  });
  mockStorage.getPayments.mockResolvedValue([]);
  mockStorage.getPaymentByIdempotencyKey.mockResolvedValue(null);
  mockStorage.createPayment.mockImplementation(async (input: Record<string, unknown>) => ({
    id: 4242, ...input,
  }));
  mockStorage.getLocationCloverConfig.mockResolvedValue({
    apiToken: 'tok_xyz', merchantId: 'merch_1', environment: 'sandbox',
  });
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

describe('POST /api/payments-provider/payments — Clover failure paths (Task #578)', () => {
  it('returns the typed user-facing decline message and does NOT persist a charge row', async () => {
    // Card decline as the Clover provider would surface it after
    // mapApiError chews on a 402 from /v1/charges.
    mockCloverProvider.processPayment.mockRejectedValue(
      new PaymentProviderError(
        'Your payment was declined. Please try a different card.',
        'PAYMENT_DECLINED',
        'card_declined: do_not_honor',
      ),
    );

    const res = await postCharge({
      sourceId: 'clv_tok_decline', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: {
        code: 'PAYMENT_DECLINED',
        message: 'Your payment was declined. Please try a different card.',
      },
    });
    // Crucially: no successful charge row is persisted on a decline.
    expect(mockStorage.createPayment).not.toHaveBeenCalled();
    // And the raw upstream `detail` never leaks into the user message.
    expect(body.error.message).not.toContain('do_not_honor');
    // Server-side logging fires so on-call gets a signal.
    expect(fakeLogger.error).toHaveBeenCalled();
    const errCall = fakeLogger.error.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('Payment processing error'),
    );
    expect(errCall).toBeDefined();
    expect(errCall?.[1]).toMatchObject({
      typedCode: 'PAYMENT_DECLINED',
      typedDetail: 'card_declined: do_not_honor',
    });
  });

  it('maps a network/timeout failure through PaymentProviderError + sanitizer', async () => {
    // The provider layer wraps a transport failure (fetch TypeError,
    // socket timeout, DNS, etc.) in PaymentProviderError(PAYMENT_FAILED).
    // The route should pass the user-facing sentence straight through.
    mockCloverProvider.processPayment.mockRejectedValue(
      new PaymentProviderError(
        'Unable to process your payment. Please try again later.',
        'PAYMENT_FAILED',
        'fetch failed: ETIMEDOUT',
      ),
    );

    const res = await postCharge({
      sourceId: 'clv_tok_net', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: {
        code: 'PAYMENT_FAILED',
        message: 'Unable to process your payment. Please try again later.',
      },
    });
    expect(mockStorage.createPayment).not.toHaveBeenCalled();
    // The transport-detail string stays server-side only.
    expect(body.error.message).not.toContain('ETIMEDOUT');
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it('scrubs JSON / multi-line userMessage through sanitizePaymentUserMessage', async () => {
    // A future regression could land a stringified JSON payload or a
    // stack-trace fragment in `userMessage`. Sanitizer must swap in
    // GENERIC_PAYMENT_USER_MESSAGE while preserving the typed code so
    // the client still gets a useful machine-readable signal.
    mockCloverProvider.processPayment.mockRejectedValue(
      new PaymentProviderError(
        '{"error":{"message":"raw clover payload","code":"oops"}}',
        'PAYMENT_DECLINED',
        'should never reach the user',
      ),
    );

    const res = await postCharge({
      sourceId: 'clv_tok_json', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toBe(GENERIC_PAYMENT_USER_MESSAGE);
    expect(body.error.code).toBe('PAYMENT_DECLINED');
    expect(mockStorage.createPayment).not.toHaveBeenCalled();
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it('falls back to the generic message + PAYMENT_ERROR code for an untyped error', async () => {
    // If a future code path forgets to wrap a failure in
    // PaymentProviderError, the route must still emit a friendly
    // sentence and NOT leak the raw error.message.
    mockCloverProvider.processPayment.mockRejectedValue(
      new Error('boom: undefined is not a function\n  at /server/services/clover.ts:123'),
    );

    const res = await postCharge({
      sourceId: 'clv_tok_oops', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: {
        code: 'PAYMENT_ERROR',
        message: GENERIC_PAYMENT_USER_MESSAGE,
      },
    });
    expect(body.error.message).not.toContain('boom');
    expect(mockStorage.createPayment).not.toHaveBeenCalled();
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe('CloverPaymentProvider.processPayment — CloverApiError mapping (Task #578)', () => {
  it('maps a 402 decline to PAYMENT_DECLINED with a sanitizer-safe userMessage', async () => {
    mockCreateCharge.mockRejectedValue(
      new CloverApiError('card_declined', 402, { error: { code: 'card_declined' } }, 'card_declined'),
    );

    const provider = new CloverPaymentProvider(99);
    await expect(
      provider.processPayment('clv_tok_decline', 2000, false, 'cv_cust_1', 'pat@example.com', 'idem-1'),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'PAYMENT_DECLINED',
      userMessage: 'Your payment was declined. Please try a different card.',
    });
  });

  it('maps a 401 (auth) into the generic SYSTEM_ERROR bucket — never leaks credentials', async () => {
    mockCreateCharge.mockRejectedValue(
      new CloverApiError('Unauthorized', 401, 'Bearer token rejected'),
    );

    const provider = new CloverPaymentProvider(99);
    await expect(
      provider.processPayment('clv_tok_auth', 2000, false, undefined, undefined, 'idem-2'),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'SYSTEM_ERROR',
      userMessage: 'Payment system is temporarily unavailable. Please try again later.',
      detail: 'Bearer token rejected',
    });
  });

  it('maps other 4xx (e.g. validation) to INVALID_REQUEST', async () => {
    mockCreateCharge.mockRejectedValue(
      new CloverApiError('amount must be positive', 400, { error: { message: 'amount must be positive' } }),
    );

    const provider = new CloverPaymentProvider(99);
    await expect(
      provider.processPayment('clv_tok_bad', 2000, false, undefined, undefined, 'idem-3'),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'INVALID_REQUEST',
      userMessage: 'Invalid payment information. Please check your card details.',
    });
  });

  it('maps a transport/timeout failure (non-CloverApiError) to PAYMENT_FAILED with detail kept for logs', async () => {
    // Simulates fetch failing before any HTTP response — the network
    // layer of node:fetch raises a plain TypeError('fetch failed').
    mockCreateCharge.mockRejectedValue(new TypeError('fetch failed'));

    const provider = new CloverPaymentProvider(99);
    await expect(
      provider.processPayment('clv_tok_timeout', 2000, false, undefined, undefined, 'idem-4'),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'PAYMENT_FAILED',
      userMessage: 'Unable to process your payment. Please try again later.',
      detail: 'fetch failed',
    });
  });

  it('passes existing PaymentProviderError instances through unchanged (no double-wrap)', async () => {
    // A PaymentProviderError thrown from inside processPayment's own
    // pre-checks (or a re-thrown one) must not be re-wrapped with a
    // generic PAYMENT_FAILED userMessage — that would clobber the
    // original code/message and confuse the client.
    const provider = new CloverPaymentProvider(99);
    await expect(
      provider.processPayment('', 2000, false, undefined, undefined, 'idem-5'),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'INVALID_REQUEST',
      userMessage: 'Missing required payment information',
    });
    // The pre-check guards short-circuit before any HTTP call.
    expect(mockCreateCharge).not.toHaveBeenCalled();
  });
});
