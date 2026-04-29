/**
 * Task #604 — Square refund failure-path coverage.
 *
 * Sibling to tests/unit/clover-refund-failures.test.ts (Task #594), and
 * the Square parallel of it. Pins the provider-failure paths so a
 * regression in either
 *   - the Square SDK error → PaymentProviderError mapping inside
 *     SquarePaymentProvider.refundPayment, or
 *   - how the refund route surfaces those failures to admins
 * gets caught early. A future refactor of the Square SDK shape (e.g.
 * the v40 flat-client migration in Task #600 / #603) could otherwise
 * silently regress refund error messaging without anything failing in
 * CI.
 *
 * Two layers are exercised:
 *
 *   1. POST /api/payments/:id/refund (route layer):
 *      - A typed INVALID_REQUEST from the provider does NOT mark the
 *        local payment row refunded, returns the provider's friendly
 *        userMessage + code to the admin, and fires log.error so on-
 *        call has signal.
 *      - A typed REFUND_FAILED (transport/timeout) surfaces the same
 *        friendly sentence + REFUND_FAILED code and likewise leaves
 *        the row untouched.
 *      - A bare `Error` thrown by the provider (no typed wrapper)
 *        still produces a sanitized message — no stack-trace leak.
 *
 *   2. SquarePaymentProvider.refundPayment (provider layer):
 *      - 402 from Square → PAYMENT_DECLINED with the canonical
 *        decline sentence (typed bucket beats the REFUND_FAILED
 *        fallback).
 *      - 401 → SYSTEM_ERROR; raw upstream `errors[0].detail` kept on
 *        `detail` server-side, not in the user message.
 *      - 403 → same SYSTEM_ERROR bucket as 401 (we never want to
 *        surface "Forbidden" to admins for a server-side credential
 *        issue).
 *      - Other 4xx → INVALID_REQUEST.
 *      - 5xx from Square → REFUND_FAILED with the friendly fallback
 *        sentence ('Refund could not be processed.').
 *      - Transport failures (e.g. fetch TypeError) → REFUND_FAILED
 *        with the original error message kept on `detail` for logs.
 *      - Already-typed PaymentProviderError / ProviderNotConfiguredError
 *        thrown from inside the try-block pass through verbatim — no
 *        double-wrap into REFUND_FAILED / PAYMENT_FAILED.
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
  getLocationSquareConfig: vi.fn(),
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

// Mock the low-level Square SDK so the provider-layer suite below can
// simulate API failures without making real HTTP calls. Only the
// `SquareClient` constructor is replaced; the real `SquareError` and
// `SquareEnvironment` exports must pass through verbatim because the
// provider does `error instanceof SquareError` and reads
// `SquareEnvironment.Production` / `Sandbox`. The route-layer suite
// uses a fully-stubbed provider object instead, so it never reaches
// these.
const mockRefundPayment = vi.fn();
vi.mock('square', async () => {
  const actual = await vi.importActual<typeof import('square')>('square');
  // The provider does `new SquareClient({...})` so the stub MUST be
  // newable. An arrow function in `mockImplementation` is not a valid
  // constructor (vitest will warn and the resulting `this` won't have
  // the `refunds` property), so use a real class instead and let
  // `new` produce an instance with a stubbed `refunds.refundPayment`
  // bound back to the per-test `mockRefundPayment` spy.
  class FakeSquareClient {
    refunds = {
      refundPayment: (...a: unknown[]) => mockRefundPayment(...a),
    };
  }
  return {
    ...actual,
    SquareClient: FakeSquareClient,
  };
});

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../server/logger', () => ({ logger: fakeLogger, createLogger: () => fakeLogger }));

const refundsRouter = (await import('../../server/routes/payments/payment-refunds')).default;
const { PaymentProviderError, ProviderNotConfiguredError } = await import(
  '../../server/services/payment-provider-factory'
);
const { SquarePaymentProvider } = await import('../../server/services/square-provider');
const { SquareError } = await import('square');

const mockSquareProvider = {
  providerName: 'square' as const,
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
  mockRefundPayment.mockReset();
  (mockSquareProvider.refundPayment as ReturnType<typeof vi.fn>).mockReset();
  fakeLogger.info.mockReset();
  fakeLogger.warn.mockReset();
  fakeLogger.error.mockReset();
  fakeLogger.debug.mockReset();

  mockHasAccessToPayment.mockResolvedValue(true);
  mockGetPaymentProvider.mockResolvedValue(mockSquareProvider);
  mockStorage.getLeague.mockResolvedValue({ id: 11, locationId: 99 });
  // Sandbox creds so `buildSquareClient` resolves to the mocked
  // SquareClient constructor without trying any production heuristics.
  mockStorage.getLocationSquareConfig.mockResolvedValue({
    accessToken: 'EAAAEsandboxtoken',
    appId: 'sandbox-sq0idp-abc',
    locationId: 'L_TEST_123',
    environment: 'sandbox',
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

const PAID_SQUARE_ROW = {
  id: 777, status: 'paid', type: 'square', leagueId: 11, amount: 2000,
  providerPaymentId: 'sq_pay_777', cloverChargeId: null,
  receiptEmailMissing: false, receiptUrl: null,
};

describe('POST /api/payments/:id/refund — Square failure paths (Task #604)', () => {
  it('does NOT mark the row refunded when the provider returns a typed INVALID_REQUEST', async () => {
    mockStorage.getPaymentById.mockResolvedValue(PAID_SQUARE_ROW);
    // The provider has already chewed a 4xx Square response into the
    // typed PaymentProviderError that the rest of the system
    // understands.
    mockSquareProvider.refundPayment.mockRejectedValue(
      new PaymentProviderError(
        'Invalid payment information. Please check your card details.',
        'INVALID_REQUEST',
        'REFUND_AMOUNT_INVALID',
      ),
    );

    const res = await postRefund(777, { reason: 'Customer request' });

    expect(res.status).toBe(500);
    const body = await res.json();
    // Task #598: the route mirrors the charge route and surfaces the
    // typed PaymentProviderError's `userMessage` + `code` directly so
    // admins see the actionable reason. The raw upstream `detail`
    // stays server-side only.
    expect(body).toMatchObject({
      success: false,
      error: {
        message: 'Invalid payment information. Please check your card details.',
        code: 'INVALID_REQUEST',
      },
    });
    expect(body.error.message).not.toContain('REFUND_AMOUNT_INVALID');
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
      detail: 'REFUND_AMOUNT_INVALID',
    });
  });

  it('surfaces the typed REFUND_FAILED message when the provider hits a transport/timeout failure', async () => {
    mockStorage.getPaymentById.mockResolvedValue(PAID_SQUARE_ROW);
    // Provider has wrapped a non-SquareError throw (fetch TypeError,
    // socket timeout, DNS, etc.) in PaymentProviderError(REFUND_FAILED)
    // with the friendly fallback sentence.
    mockSquareProvider.refundPayment.mockRejectedValue(
      new PaymentProviderError(
        'Refund could not be processed.',
        'REFUND_FAILED',
        'fetch failed: ETIMEDOUT',
      ),
    );

    const res = await postRefund(777, { reason: 'Duplicate' });

    expect(res.status).toBe(500);
    const body = await res.json();
    // Typed REFUND_FAILED makes it through to the admin toast so they
    // know it's a "try again" condition rather than a declined card.
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
    mockStorage.getPaymentById.mockResolvedValue(PAID_SQUARE_ROW);
    // If a future code path in refundPayment lets a bare Error escape
    // (no PaymentProviderError wrapping), the route's catch-all must
    // still emit a friendly sentence and NOT leak error.message /
    // stack to the admin client.
    mockSquareProvider.refundPayment.mockRejectedValue(
      new Error('boom: undefined is not a function\n  at /server/services/square-provider.ts:99'),
    );

    const res = await postRefund(777, { reason: 'Oops' });

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
    expect(body.error.message).not.toContain('square-provider.ts');
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe('SquarePaymentProvider.refundPayment — SquareError mapping (Task #604)', () => {
  // SquareError derives `errors[]` from `body.errors` — see
  // node_modules/square/errors/SquareError.js. Helper keeps each spec
  // focused on the status-code → typed-bucket mapping under test
  // rather than the SDK ctor shape.
  function squareErr(statusCode: number, detail?: string, code = 'GENERIC_DECLINE') {
    return new SquareError({
      message: 'square error',
      statusCode,
      body: detail
        ? { errors: [{ category: 'PAYMENT_METHOD_ERROR', code, detail }] }
        : { errors: [] },
    });
  }

  it('maps a 402 decline to PAYMENT_DECLINED (typed bucket beats the REFUND_FAILED fallback)', async () => {
    mockRefundPayment.mockRejectedValue(squareErr(402, 'CARD_DECLINED', 'CARD_DECLINED'));

    const provider = new SquarePaymentProvider(99);
    await expect(provider.refundPayment('sq_pay_777', 2000, 'Customer request'))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'PAYMENT_DECLINED',
        userMessage: 'Your payment was declined. Please try a different card.',
        detail: 'CARD_DECLINED',
      });
  });

  it('maps a 401 (auth) into SYSTEM_ERROR — never leaks the credential body to the user', async () => {
    mockRefundPayment.mockRejectedValue(squareErr(401, 'Bearer token rejected', 'UNAUTHORIZED'));

    const provider = new SquarePaymentProvider(99);
    await expect(provider.refundPayment('sq_pay_777', 2000))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'SYSTEM_ERROR',
        userMessage: 'Payment system is temporarily unavailable. Please try again later.',
        detail: 'Bearer token rejected',
      });
  });

  it('maps a 403 (forbidden) into the same SYSTEM_ERROR bucket as 401', async () => {
    // 401 and 403 share the auth-failure branch in the provider's
    // catch; if a future refactor splits them, this test pins that
    // 403 must keep the SYSTEM_ERROR mapping (we never want to
    // surface a "Forbidden" string to admins for a server-side
    // credential issue).
    mockRefundPayment.mockRejectedValue(squareErr(403, 'merchant disabled', 'FORBIDDEN'));

    const provider = new SquarePaymentProvider(99);
    await expect(provider.refundPayment('sq_pay_777', 2000))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'SYSTEM_ERROR',
        userMessage: 'Payment system is temporarily unavailable. Please try again later.',
      });
  });

  it('maps other 4xx (e.g. validation) to INVALID_REQUEST', async () => {
    mockRefundPayment.mockRejectedValue(
      squareErr(400, 'amount must be positive', 'BAD_REQUEST'),
    );

    const provider = new SquarePaymentProvider(99);
    await expect(provider.refundPayment('sq_pay_777', 2000))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'INVALID_REQUEST',
        userMessage: 'Invalid payment information. Please check your card details.',
        detail: 'amount must be positive',
      });
  });

  it('maps a 5xx upstream failure to REFUND_FAILED with the friendly fallback sentence', async () => {
    // Anything not matched by 401/402/403/4xx falls through to the
    // (REFUND_FAILED, 'Refund could not be processed.') bucket —
    // the exact pair the task wants pinned.
    mockRefundPayment.mockRejectedValue(
      squareErr(503, 'upstream timeout', 'INTERNAL_SERVER_ERROR'),
    );

    const provider = new SquarePaymentProvider(99);
    await expect(provider.refundPayment('sq_pay_777', 2000))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'REFUND_FAILED',
        userMessage: 'Refund could not be processed.',
      });
  });

  it('maps a transport/timeout failure (non-SquareError) to REFUND_FAILED with detail kept for logs', async () => {
    // Simulates fetch failing before any HTTP response — node:fetch
    // raises a plain TypeError('fetch failed') in this case. The
    // `instanceof SquareError` check fails so the catch falls through
    // to the (REFUND_FAILED, 'Refund could not be processed.') bucket
    // with `detail` kept from the original error.message for logs.
    mockRefundPayment.mockRejectedValue(new TypeError('fetch failed'));

    const provider = new SquarePaymentProvider(99);
    // Single provider call — capture the typed rejection once and
    // run every assertion against it. Non-SquareError throws have no
    // `errors[0].detail` to read so `detail` is intentionally not
    // populated; the important guarantee is that the user-facing
    // fields stay hand-authored and the raw transport message must
    // NOT appear in `userMessage`.
    const err = (await provider.refundPayment('sq_pay_777', 2000).then(
      () => {
        throw new Error('refundPayment unexpectedly resolved instead of rejecting');
      },
      (e: unknown) => e,
    )) as { name: string; code: string; userMessage: string };

    expect(err).toMatchObject({
      name: 'PaymentProviderError',
      code: 'REFUND_FAILED',
      userMessage: 'Refund could not be processed.',
    });
    expect(err.userMessage).not.toContain('fetch failed');
  });

  it('passes existing PaymentProviderError instances through unchanged (no double-wrap)', async () => {
    // If a future code path inside refundPayment (or its dependencies)
    // throws an already-typed PaymentProviderError, the catch must
    // re-throw it as-is — wrapping it in REFUND_FAILED would clobber
    // the original code/message and confuse the route + client.
    const original = new PaymentProviderError(
      'Your payment was declined. Please try a different card.',
      'PAYMENT_DECLINED',
      'do_not_honor',
    );
    mockRefundPayment.mockRejectedValue(original);

    const provider = new SquarePaymentProvider(99);
    await expect(provider.refundPayment('sq_pay_777', 2000))
      .rejects.toMatchObject({
        name: 'PaymentProviderError',
        code: 'PAYMENT_DECLINED',
        userMessage: 'Your payment was declined. Please try a different card.',
        detail: 'do_not_honor',
      });
  });

  it('passes ProviderNotConfiguredError through unchanged (no wrap into REFUND_FAILED)', async () => {
    // Same passthrough invariant for the PNCE branch — the route
    // relies on `instanceof ProviderNotConfiguredError` to map this
    // to a 422 PROVIDER_NOT_CONFIGURED instead of a generic 500
    // (task #332). If the catch double-wraps it into a typed
    // REFUND_FAILED, admins lose the "Square isn't connected for
    // this location" signal.
    const pnce = new ProviderNotConfiguredError(
      'Square client not configured for this location',
      99,
    );
    mockRefundPayment.mockRejectedValue(pnce);

    const provider = new SquarePaymentProvider(99);
    await expect(provider.refundPayment('sq_pay_777', 2000))
      .rejects.toBe(pnce);
  });
});
