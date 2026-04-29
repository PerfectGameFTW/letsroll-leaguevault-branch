/**
 * Task #594 — Clover refund failure-path coverage.
 *
 * Sibling to tests/unit/clover-refund.test.ts (Task #574), which only
 * covers the success / legacy-fallback / already-refunded paths. This
 * file pins the provider-failure paths so a regression in either
 *   - the CloverApiError → PaymentProviderError mapping inside
 *     CloverPaymentProvider.refundPayment, or
 *   - how the refund route surfaces those failures to admins
 * gets caught early. Mirrors the shape of
 * tests/unit/clover-charge-failures.test.ts (Task #578).
 *
 * Two layers are exercised:
 *
 *   1. POST /api/payments/:id/refund (route layer):
 *      - A 4xx decline from the provider does NOT mark the local
 *        payment row refunded, returns a friendly user-facing
 *        message, and fires log.error so on-call has signal.
 *      - A transport/timeout failure surfaces the same friendly
 *        sentence and likewise leaves the row untouched.
 *      - A bare `Error` thrown by the provider (no typed wrapper)
 *        still produces a sanitized message — no stack-trace leak.
 *
 *   2. CloverPaymentProvider.refundPayment (provider layer):
 *      - 402 from Clover → PAYMENT_DECLINED with the canonical
 *        decline sentence (mapApiError prefers the typed bucket
 *        over the REFUND_FAILED fallback).
 *      - 401/403 → SYSTEM_ERROR; raw upstream string kept on
 *        `detail` server-side, not in the user message.
 *      - Other 4xx → INVALID_REQUEST.
 *      - 5xx from Clover → REFUND_FAILED with the friendly
 *        fallback sentence ('Refund could not be processed.').
 *      - Transport failures (e.g. fetch TypeError) → REFUND_FAILED
 *        with the original error message kept on `detail` for logs.
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
  getLocationCloverConfig: vi.fn(),
};
vi.mock('../../server/storage', () => ({ storage: mockStorage }));

const mockHasAccessToPayment = vi.fn();
vi.mock('../../server/utils/access-control', () => ({
  hasAccessToPayment: (...a: unknown[]) => mockHasAccessToPayment(...a),
}));

vi.mock('../../server/middleware/rate-limit', () => ({
  paymentWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Use the REAL PaymentProviderError / ProviderNotConfiguredError so
// the route's `instanceof ProviderNotConfiguredError` branch behaves
// exactly as in production. Only `getPaymentProvider` is faked out so
// the route resolves to our mock provider stub for the route-layer
// suite below.
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

// Mock the low-level Clover SDK so the provider-layer suite below
// can simulate API failures without making real HTTP calls. The
// route-layer suite uses a fully-stubbed provider object instead, so
// it never reaches these.
const mockCreateRefund = vi.fn();
vi.mock('../../server/services/clover', async () => {
  const actual = await vi.importActual<typeof import('../../server/services/clover')>(
    '../../server/services/clover',
  );
  return {
    ...actual,
    createRefund: (...a: unknown[]) => mockCreateRefund(...a),
  };
});

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../server/logger', () => ({ logger: fakeLogger, createLogger: () => fakeLogger }));

const refundsRouter = (await import('../../server/routes/payments/payment-refunds')).default;
const { PaymentProviderError } = await import('../../server/services/payment-provider-factory');
const { CloverPaymentProvider } = await import('../../server/services/clover-provider');
const { CloverApiError } = await import('../../server/services/clover');

const mockCloverProvider = {
  providerName: 'clover' as const,
  locationId: 99,
  refundPayment: vi.fn(),
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
  mockCreateRefund.mockReset();
  (mockCloverProvider.refundPayment as ReturnType<typeof vi.fn>).mockReset();
  fakeLogger.info.mockReset();
  fakeLogger.warn.mockReset();
  fakeLogger.error.mockReset();
  fakeLogger.debug.mockReset();

  mockHasAccessToPayment.mockResolvedValue(true);
  mockGetPaymentProvider.mockResolvedValue(mockCloverProvider);
  mockStorage.getLeague.mockResolvedValue({ id: 11, locationId: 99 });
  mockStorage.getLocationCloverConfig.mockResolvedValue({
    apiToken: 'tok_xyz', merchantId: 'merch_1', environment: 'sandbox',
  });
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

const PAID_CLOVER_ROW = {
  id: 555, status: 'paid', type: 'clover', leagueId: 11, amount: 2000,
  providerPaymentId: 'cv_pay_555', cloverChargeId: 'cv_pay_555',
  receiptEmailMissing: false, receiptUrl: null,
};

describe('POST /api/payments/:id/refund — Clover failure paths (Task #594)', () => {
  it('does NOT mark the row refunded when the provider returns a 4xx decline', async () => {
    mockStorage.getPaymentById.mockResolvedValue(PAID_CLOVER_ROW);
    // The provider has already chewed a 4xx Clover response through
    // mapApiError and is throwing the typed PaymentProviderError that
    // the rest of the system understands.
    mockCloverProvider.refundPayment.mockRejectedValue(
      new PaymentProviderError(
        'Invalid payment information. Please check your card details.',
        'INVALID_REQUEST',
        'refund_amount_exceeds_charge',
      ),
    );

    const res = await postRefund(555, { reason: 'Customer request' });

    expect(res.status).toBe(500);
    const body = await res.json();
    // Task #598: the route now mirrors the charge route and surfaces
    // the typed PaymentProviderError's `userMessage` + `code` directly
    // so admins see the actionable reason. The raw upstream `detail`
    // stays server-side only.
    expect(body).toMatchObject({
      success: false,
      error: {
        message: 'Invalid payment information. Please check your card details.',
        code: 'INVALID_REQUEST',
      },
    });
    expect(body.error.message).not.toContain('refund_amount_exceeds_charge');
    // Critically: the local payment row is NOT marked refunded when
    // the provider fails — otherwise the customer's money status in
    // our DB diverges from the actual money movement.
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
    // log.error fires with the real provider error so on-call has
    // signal (the typed code/detail are preserved on the Error).
    expect(fakeLogger.error).toHaveBeenCalled();
    const errCall = fakeLogger.error.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('Refund error'),
    );
    expect(errCall).toBeDefined();
    expect(errCall?.[1]).toBeInstanceOf(PaymentProviderError);
    expect(errCall?.[1]).toMatchObject({
      code: 'INVALID_REQUEST',
      detail: 'refund_amount_exceeds_charge',
    });
  });

  it('surfaces the typed REFUND_FAILED message when the provider hits a transport/timeout failure', async () => {
    mockStorage.getPaymentById.mockResolvedValue(PAID_CLOVER_ROW);
    // mapApiError wraps a non-CloverApiError throw (fetch TypeError,
    // socket timeout, DNS, etc.) in PaymentProviderError(REFUND_FAILED)
    // with the friendly fallback sentence.
    mockCloverProvider.refundPayment.mockRejectedValue(
      new PaymentProviderError(
        'Refund could not be processed.',
        'REFUND_FAILED',
        'fetch failed: ETIMEDOUT',
      ),
    );

    const res = await postRefund(555, { reason: 'Duplicate' });

    expect(res.status).toBe(500);
    const body = await res.json();
    // Task #598: typed REFUND_FAILED makes it through to the admin
    // toast so they know it's a "try again" condition rather than a
    // declined card.
    expect(body).toMatchObject({
      success: false,
      error: {
        message: 'Refund could not be processed.',
        code: 'REFUND_FAILED',
      },
    });
    // Transport detail stays server-side only.
    expect(body.error.message).not.toContain('ETIMEDOUT');
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
    expect(fakeLogger.error).toHaveBeenCalled();
    const errCall = fakeLogger.error.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('Refund error'),
    );
    expect(errCall?.[1]).toMatchObject({
      code: 'REFUND_FAILED',
      detail: 'fetch failed: ETIMEDOUT',
    });
  });

  it('still scrubs the response when the provider forgets the typed wrapper', async () => {
    mockStorage.getPaymentById.mockResolvedValue(PAID_CLOVER_ROW);
    // If a future code path in refundPayment forgets to call
    // mapApiError and lets a bare Error escape, the route's catch-all
    // must still emit a friendly sentence and NOT leak error.message
    // / stack to the admin client.
    mockCloverProvider.refundPayment.mockRejectedValue(
      new Error('boom: undefined is not a function\n  at /server/services/clover.ts:99'),
    );

    const res = await postRefund(555, { reason: 'Oops' });

    expect(res.status).toBe(500);
    const body = await res.json();
    // Untyped errors fall through to the legacy "Failed to process
    // refund" fallback (with the REFUND_ERROR code) — guaranteeing
    // no stack-trace text from `error.message` ever leaks out.
    expect(body).toMatchObject({
      success: false,
      error: { message: 'Failed to process refund', code: 'REFUND_ERROR' },
    });
    expect(body.error.message).not.toContain('boom');
    expect(body.error.message).not.toContain('clover.ts');
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe('CloverPaymentProvider.refundPayment — CloverApiError mapping (Task #594)', () => {
  it('maps a 402 decline to PAYMENT_DECLINED (typed bucket beats the REFUND_FAILED fallback)', async () => {
    mockCreateRefund.mockRejectedValue(
      new CloverApiError(
        'card_declined',
        402,
        { error: { code: 'card_declined' } },
        'card_declined',
      ),
    );

    const provider = new CloverPaymentProvider(99);
    await expect(provider.refundPayment('cv_pay_555', 2000, 'Customer request'))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'PAYMENT_DECLINED',
        userMessage: 'Your payment was declined. Please try a different card.',
      });
  });

  it('maps a 401 (auth) into SYSTEM_ERROR — never leaks the credential body to the user', async () => {
    mockCreateRefund.mockRejectedValue(
      new CloverApiError('Unauthorized', 401, 'Bearer token rejected'),
    );

    const provider = new CloverPaymentProvider(99);
    await expect(provider.refundPayment('cv_pay_555', 2000))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'SYSTEM_ERROR',
        userMessage: 'Payment system is temporarily unavailable. Please try again later.',
        detail: 'Bearer token rejected',
      });
  });

  it('maps a 403 (forbidden) into the same SYSTEM_ERROR bucket as 401', async () => {
    // 401 and 403 share the auth-failure branch in mapApiError; if a
    // future refactor splits them, this test pins that 403 must keep
    // the SYSTEM_ERROR mapping (we never want to surface a "Forbidden"
    // string to admins for a server-side credential issue).
    mockCreateRefund.mockRejectedValue(
      new CloverApiError('Forbidden', 403, { error: { message: 'merchant disabled' } }),
    );

    const provider = new CloverPaymentProvider(99);
    await expect(provider.refundPayment('cv_pay_555', 2000))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'SYSTEM_ERROR',
        userMessage: 'Payment system is temporarily unavailable. Please try again later.',
      });
  });

  it('maps other 4xx (e.g. validation) to INVALID_REQUEST', async () => {
    mockCreateRefund.mockRejectedValue(
      new CloverApiError(
        'amount must be positive',
        400,
        { error: { message: 'amount must be positive' } },
      ),
    );

    const provider = new CloverPaymentProvider(99);
    await expect(provider.refundPayment('cv_pay_555', 2000))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'INVALID_REQUEST',
        userMessage: 'Invalid payment information. Please check your card details.',
      });
  });

  it('maps a 5xx upstream failure to REFUND_FAILED with the friendly fallback sentence', async () => {
    // Anything not matched by 401/403/402/4xx falls through to the
    // (fallbackMessage, fallbackCode) bucket — for refundPayment that
    // means the exact pair the task wants pinned.
    mockCreateRefund.mockRejectedValue(
      new CloverApiError('internal server error', 503, { error: { message: 'upstream timeout' } }),
    );

    const provider = new CloverPaymentProvider(99);
    await expect(provider.refundPayment('cv_pay_555', 2000))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'REFUND_FAILED',
        userMessage: 'Refund could not be processed.',
      });
  });

  it('maps a transport/timeout failure (non-CloverApiError) to REFUND_FAILED with detail kept for logs', async () => {
    // Simulates fetch failing before any HTTP response — node:fetch
    // raises a plain TypeError('fetch failed') in this case.
    mockCreateRefund.mockRejectedValue(new TypeError('fetch failed'));

    const provider = new CloverPaymentProvider(99);
    await expect(provider.refundPayment('cv_pay_555', 2000))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'REFUND_FAILED',
        userMessage: 'Refund could not be processed.',
        detail: 'fetch failed',
      });
  });

  it('passes existing PaymentProviderError instances through unchanged (no double-wrap)', async () => {
    // If a future code path inside refundPayment (or its dependencies)
    // throws an already-typed PaymentProviderError, mapApiError must
    // re-throw it as-is — wrapping it in REFUND_FAILED would clobber
    // the original code/message and confuse the route + client.
    const original = new PaymentProviderError(
      'Your payment was declined. Please try a different card.',
      'PAYMENT_DECLINED',
      'do_not_honor',
    );
    mockCreateRefund.mockRejectedValue(original);

    const provider = new CloverPaymentProvider(99);
    await expect(provider.refundPayment('cv_pay_555', 2000))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'PAYMENT_DECLINED',
        userMessage: 'Your payment was declined. Please try a different card.',
        detail: 'do_not_honor',
      });
  });
});
