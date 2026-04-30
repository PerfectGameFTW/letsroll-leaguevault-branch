/**
 * Task #619 — Square charge failure-path coverage.
 *
 * Square parallel of tests/unit/clover-charge-failures.test.ts (Task
 * #578). Locks in the user-facing messaging for failed Square charges
 * so a future Square SDK refactor (e.g. another flat-client cleanup
 * after Tasks #600 / #603) cannot silently regress what admins see
 * when a charge fails. The Clover side already had this coverage; the
 * Square side did not — the refund-side equivalent (Task #604, in
 * tests/unit/square-refund-failures.test.ts) is the closest sibling
 * and the Square mock setup here is intentionally identical to it.
 *
 * Two layers are exercised:
 *
 *   1. POST /api/payments-provider/payments (route layer):
 *      - Card decline surfaces the typed PaymentProviderError's
 *        userMessage + code to the admin and does NOT persist a
 *        payment row.
 *      - A network/timeout-style failure from the provider is mapped
 *        through PaymentProviderError + sanitizePaymentUserMessage
 *        and stays human-readable.
 *      - A PaymentProviderError whose `userMessage` accidentally
 *        carries JSON / a multi-line stack-trace fragment is scrubbed
 *        by sanitizePaymentUserMessage on the way out.
 *      - A bare `Error` (forgot the typed wrapper) returns the
 *        generic safe message + the generic PAYMENT_ERROR code.
 *      - Every failure path fires log.error so on-call has signal.
 *
 *   2. SquarePaymentProvider.processPayment + .createOrderWithPayment
 *      (provider layer): both methods map SquareError statusCodes the
 *      same way:
 *      - 400 → INVALID_REQUEST (the two methods do have different
 *        hand-authored userMessage sentences — both are pinned).
 *      - 401 → SYSTEM_ERROR with the same safe "temporarily
 *        unavailable" sentence (Task #619 closed an asymmetry where
 *        createOrderWithPayment used to fall through to PAYMENT_FAILED
 *        on a 401; both methods now share the SYSTEM_ERROR contract).
 *      - 402 → PAYMENT_DECLINED with the canonical decline sentence.
 *      - Fallback (non-mapped status / non-SquareError) →
 *        PAYMENT_FAILED, with each method's own fallback sentence.
 *      - Already-typed PaymentProviderError / ProviderNotConfiguredError
 *        thrown from inside the try-block pass through verbatim — no
 *        double-wrap into PAYMENT_FAILED.
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
  getLocationSquareConfig: vi.fn(),
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
// out so the route resolves to our mock provider stub for the route-
// layer suite below.
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
  // Force buildLineItems back to [] so the route always exercises
  // processPayment (not createOrderWithPayment) for the route-layer
  // suite. The order-flow has its own provider-layer coverage below.
  buildLineItems: () => [],
}));

vi.mock('../../server/services/payment-utils', () => ({
  getProviderCustomerId: (bowler: { squareCustomerId?: string }) =>
    bowler.squareCustomerId,
  persistCloverCustomer: vi.fn(),
  ensureProviderCustomer: vi.fn(),
}));

vi.mock('../../server/routes/payments-provider/shared', () => ({
  getProviderForLeague: vi.fn(),
}));

// Mock the low-level Square SDK so the provider-layer suite below can
// simulate API failures without making real HTTP calls. Only the
// `SquareClient` constructor is replaced; the real `SquareError` and
// `SquareEnvironment` exports must pass through verbatim because the
// provider does `error instanceof SquareError` and reads
// `SquareEnvironment.Production` / `Sandbox`. The route-layer suite
// uses a fully-stubbed provider object instead, so it never reaches
// these.
const mockPaymentsCreate = vi.fn();
const mockOrdersCreate = vi.fn();
vi.mock('square', async () => {
  const actual = await vi.importActual<typeof import('square')>('square');
  // The provider does `new SquareClient({...})` so the stub MUST be
  // newable. An arrow function in `mockImplementation` is not a valid
  // constructor, so use a real class and let `new` produce an instance
  // with stubbed `.payments.create` / `.orders.create` bound back to
  // the per-test spies.
  class FakeSquareClient {
    payments = { create: (...a: unknown[]) => mockPaymentsCreate(...a) };
    orders = { create: (...a: unknown[]) => mockOrdersCreate(...a) };
  }
  return {
    ...actual,
    SquareClient: FakeSquareClient,
  };
});

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../server/logger', () => ({ logger: fakeLogger, createLogger: () => fakeLogger }));

const chargesRouter = (await import('../../server/routes/payments-provider/charges')).default;
const {
  PaymentProviderError,
  ProviderNotConfiguredError,
  GENERIC_PAYMENT_USER_MESSAGE,
} = await import('../../server/services/payment-provider-factory');
const { SquarePaymentProvider } = await import('../../server/services/square-provider');
const { SquareError } = await import('square');

const mockSquareProvider = {
  providerName: 'square' as const,
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
  mockPaymentsCreate.mockReset();
  mockOrdersCreate.mockReset();
  for (const fn of [
    mockSquareProvider.processPayment,
    mockSquareProvider.createOrderWithPayment,
    mockSquareProvider.getPayment,
    mockSquareProvider.saveCardOnFile,
  ]) {
    (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  mockSquareProvider.validateCardId.mockReset().mockReturnValue(false);
  fakeLogger.info.mockReset();
  fakeLogger.warn.mockReset();
  fakeLogger.error.mockReset();
  fakeLogger.debug.mockReset();

  mockHasAccessToLeague.mockResolvedValue(true);
  mockHasAccessToBowler.mockResolvedValue(true);
  mockGetPaymentProvider.mockResolvedValue(mockSquareProvider);
  mockStorage.getLeague.mockResolvedValue({
    id: 11, organizationId: 1, weeklyFee: 2000, lineageFee: 0, prizeFundFee: 0,
    seasonStart: '2026-01-01', seasonEnd: '2026-04-01', totalBowlingWeeks: 12,
    cancelledDates: [], locationId: 99,
  });
  mockStorage.getBowler.mockResolvedValue({
    id: 42, name: 'Pat', email: 'pat@example.com', squareCustomerId: 'sq_cust_1',
  });
  mockStorage.getPayments.mockResolvedValue([]);
  mockStorage.getPaymentByIdempotencyKey.mockResolvedValue(null);
  mockStorage.createPayment.mockImplementation(async (input: Record<string, unknown>) => ({
    id: 4242, ...input,
  }));
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

describe('POST /api/payments-provider/payments — Square failure paths (Task #619)', () => {
  it('returns the typed user-facing decline message and does NOT persist a charge row', async () => {
    // Card decline as the Square provider would surface it after the
    // 402-branch catch in processPayment chews on a Square 402.
    mockSquareProvider.processPayment.mockRejectedValue(
      new PaymentProviderError(
        'Your payment was declined. Please try a different card.',
        'PAYMENT_DECLINED',
        'CARD_DECLINED',
      ),
    );

    const res = await postCharge({
      sourceId: 'cnon:card-nonce-decline', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
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
    expect(body.error.message).not.toContain('CARD_DECLINED');
    // Server-side logging fires so on-call gets a signal.
    expect(fakeLogger.error).toHaveBeenCalled();
    const errCall = fakeLogger.error.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('Payment processing error'),
    );
    expect(errCall).toBeDefined();
    expect(errCall?.[1]).toMatchObject({
      typedCode: 'PAYMENT_DECLINED',
      typedDetail: 'CARD_DECLINED',
    });
  });

  it('maps a network/timeout failure through PaymentProviderError + sanitizer', async () => {
    // The provider layer wraps a transport failure (fetch TypeError,
    // socket timeout, DNS, etc.) in PaymentProviderError(PAYMENT_FAILED).
    // The route should pass the user-facing sentence straight through.
    mockSquareProvider.processPayment.mockRejectedValue(
      new PaymentProviderError(
        'Unable to process your payment. Please try again later.',
        'PAYMENT_FAILED',
        'fetch failed: ETIMEDOUT',
      ),
    );

    const res = await postCharge({
      sourceId: 'cnon:card-nonce-net', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
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
    mockSquareProvider.processPayment.mockRejectedValue(
      new PaymentProviderError(
        '{"errors":[{"code":"CARD_DECLINED","detail":"raw square payload"}]}',
        'PAYMENT_DECLINED',
        'should never reach the user',
      ),
    );

    const res = await postCharge({
      sourceId: 'cnon:card-nonce-json', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
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
    mockSquareProvider.processPayment.mockRejectedValue(
      new Error('boom: undefined is not a function\n  at /server/services/square-provider.ts:231'),
    );

    const res = await postCharge({
      sourceId: 'cnon:card-nonce-oops', amount: 2000, bowlerId: 42, leagueId: 11, storeCard: false,
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
    expect(body.error.message).not.toContain('square-provider.ts');
    expect(mockStorage.createPayment).not.toHaveBeenCalled();
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

// SquareError derives `errors[]` from `body.errors` — see
// node_modules/square/errors/SquareError.js. Helper keeps each spec
// focused on the status-code → typed-bucket mapping under test rather
// than the SDK ctor shape. Identical to the helper in
// tests/unit/square-refund-failures.test.ts (Task #604).
function squareErr(statusCode: number, detail?: string, code = 'GENERIC_DECLINE') {
  return new SquareError({
    message: 'square error',
    statusCode,
    body: detail
      ? { errors: [{ category: 'PAYMENT_METHOD_ERROR', code, detail }] }
      : { errors: [] },
  });
}

describe('SquarePaymentProvider.processPayment — SquareError mapping (Task #619)', () => {
  it('maps a 400 (validation) to INVALID_REQUEST with the charge-flow sentence', async () => {
    mockPaymentsCreate.mockRejectedValue(
      squareErr(400, 'amount must be positive', 'BAD_REQUEST'),
    );

    const provider = new SquarePaymentProvider(99);
    await expect(
      provider.processPayment('cnon:bad', 2000, false, undefined, 'pat@example.com', 'idem-1'),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'INVALID_REQUEST',
      userMessage: 'Invalid payment information. Please check your card details.',
      detail: 'amount must be positive',
    });
  });

  it('maps a 401 (auth) into the generic SYSTEM_ERROR bucket — never leaks credentials', async () => {
    mockPaymentsCreate.mockRejectedValue(
      squareErr(401, 'Bearer token rejected', 'UNAUTHORIZED'),
    );

    const provider = new SquarePaymentProvider(99);
    await expect(
      provider.processPayment('cnon:auth', 2000, false, undefined, 'pat@example.com', 'idem-2'),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'SYSTEM_ERROR',
      userMessage: 'Payment system is temporarily unavailable. Please try again later.',
      detail: 'Bearer token rejected',
    });
  });

  it('maps a 402 decline to PAYMENT_DECLINED with the canonical decline sentence', async () => {
    mockPaymentsCreate.mockRejectedValue(squareErr(402, 'CARD_DECLINED', 'CARD_DECLINED'));

    const provider = new SquarePaymentProvider(99);
    await expect(
      provider.processPayment('cnon:decline', 2000, false, 'sq_cust_1', 'pat@example.com', 'idem-3'),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'PAYMENT_DECLINED',
      userMessage: 'Your payment was declined. Please try a different card.',
      detail: 'CARD_DECLINED',
    });
  });

  it('maps a transport/timeout failure (non-SquareError) to PAYMENT_FAILED with the charge-flow fallback', async () => {
    // Simulates fetch failing before any HTTP response — the network
    // layer of node:fetch raises a plain TypeError('fetch failed').
    // The `instanceof SquareError` check fails so the catch falls
    // through to the (PAYMENT_FAILED, "Unable to process your
    // payment...") bucket.
    mockPaymentsCreate.mockRejectedValue(new TypeError('fetch failed'));

    const provider = new SquarePaymentProvider(99);
    const err = (await provider.processPayment(
      'cnon:timeout', 2000, false, undefined, 'pat@example.com', 'idem-4',
    ).then(
      () => { throw new Error('processPayment unexpectedly resolved instead of rejecting'); },
      (e: unknown) => e,
    )) as { name: string; code: string; userMessage: string };

    expect(err).toMatchObject({
      name: 'PaymentProviderError',
      code: 'PAYMENT_FAILED',
      userMessage: 'Unable to process your payment. Please try again later.',
    });
    // Raw transport message must not appear in the user-facing field.
    expect(err.userMessage).not.toContain('fetch failed');
  });

  it('passes existing PaymentProviderError instances through unchanged (no double-wrap)', async () => {
    // A PaymentProviderError thrown from inside processPayment's own
    // pre-checks must not be re-wrapped with a generic PAYMENT_FAILED
    // userMessage — that would clobber the original code/message and
    // confuse the client.
    const provider = new SquarePaymentProvider(99);
    await expect(
      provider.processPayment('', 2000, false, undefined, 'pat@example.com', 'idem-5'),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'INVALID_REQUEST',
      userMessage: 'Missing required payment information',
    });
    // The pre-check guards short-circuit before any HTTP call.
    expect(mockPaymentsCreate).not.toHaveBeenCalled();
  });

  it('passes ProviderNotConfiguredError through unchanged (no wrap into PAYMENT_FAILED)', async () => {
    // Same passthrough invariant as the refund-side PNCE test — the
    // route relies on `instanceof ProviderNotConfiguredError` to map
    // this to a 422 PROVIDER_NOT_CONFIGURED instead of a generic 500
    // (task #332). If the catch double-wraps it into PAYMENT_FAILED,
    // admins lose the "Square isn't connected for this location"
    // signal. PNCE is raised from getSquareClient when there are no
    // creds — exercise that path by returning empty creds.
    mockStorage.getLocationSquareConfig.mockResolvedValue({
      accessToken: '',
      appId: '',
      locationId: '',
      environment: 'sandbox',
    });

    const provider = new SquarePaymentProvider(99);
    await expect(
      provider.processPayment('cnon:nope', 2000, false, undefined, 'pat@example.com', 'idem-6'),
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    expect(mockPaymentsCreate).not.toHaveBeenCalled();
  });
});

describe('SquarePaymentProvider.createOrderWithPayment — SquareError mapping (Task #619)', () => {
  // Order-flow always creates the order first, then the payment; the
  // failure-mapping catch wraps both calls. Each test below stubs the
  // order create to succeed and lets the payment create raise — that
  // exercises the mapping-on-the-payment-failure path which is the
  // common production failure mode (the order creation itself is rare
  // to fail because we control its inputs).
  beforeEach(() => {
    mockOrdersCreate.mockResolvedValue({ order: { id: 'sq_order_1' } });
  });

  it('maps a 400 (validation) to INVALID_REQUEST with the order-flow sentence', async () => {
    // Note: the order-flow's INVALID_REQUEST userMessage is DIFFERENT
    // from processPayment's. Both are intentional and pinned so a
    // future "let's unify these" refactor surfaces in CI.
    mockPaymentsCreate.mockRejectedValue(
      squareErr(400, 'amount must be positive', 'BAD_REQUEST'),
    );

    const provider = new SquarePaymentProvider(99);
    await expect(
      provider.createOrderWithPayment(
        'cnon:bad', 2000, [{ catalogObjectId: 'sq_cat_var_1', quantity: '1' }],
        false, undefined, 'pat@example.com', 'idem-1',
      ),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'INVALID_REQUEST',
      userMessage: 'Payment could not be processed. Please check your details and try again.',
      detail: 'amount must be positive',
    });
  });

  it('maps a 401 (auth) into the generic SYSTEM_ERROR bucket — never leaks credentials', async () => {
    // Same SYSTEM_ERROR contract as processPayment above — both Square
    // charge methods must hand admins the "temporarily unavailable"
    // sentence on a credential failure rather than a card-retry prompt.
    mockPaymentsCreate.mockRejectedValue(
      squareErr(401, 'Bearer token rejected', 'UNAUTHORIZED'),
    );

    const provider = new SquarePaymentProvider(99);
    await expect(
      provider.createOrderWithPayment(
        'cnon:auth', 2000, [{ catalogObjectId: 'sq_cat_var_1', quantity: '1' }],
        false, undefined, 'pat@example.com', 'idem-2',
      ),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'SYSTEM_ERROR',
      userMessage: 'Payment system is temporarily unavailable. Please try again later.',
      detail: 'Bearer token rejected',
    });
  });

  it('maps a 402 decline to PAYMENT_DECLINED with the canonical decline sentence', async () => {
    mockPaymentsCreate.mockRejectedValue(squareErr(402, 'CARD_DECLINED', 'CARD_DECLINED'));

    const provider = new SquarePaymentProvider(99);
    await expect(
      provider.createOrderWithPayment(
        'cnon:decline', 2000, [{ catalogObjectId: 'sq_cat_var_1', quantity: '1' }],
        false, 'sq_cust_1', 'pat@example.com', 'idem-3',
      ),
    ).rejects.toMatchObject({
      name: 'PaymentProviderError',
      code: 'PAYMENT_DECLINED',
      userMessage: 'Your payment was declined. Please try a different card.',
      detail: 'CARD_DECLINED',
    });
  });

  it('maps a transport/timeout failure (non-SquareError) to PAYMENT_FAILED with the order-flow fallback', async () => {
    mockPaymentsCreate.mockRejectedValue(new TypeError('fetch failed'));

    const provider = new SquarePaymentProvider(99);
    const err = (await provider.createOrderWithPayment(
      'cnon:timeout', 2000, [{ catalogObjectId: 'sq_cat_var_1', quantity: '1' }],
      false, undefined, 'pat@example.com', 'idem-4',
    ).then(
      () => { throw new Error('createOrderWithPayment unexpectedly resolved instead of rejecting'); },
      (e: unknown) => e,
    )) as { name: string; code: string; userMessage: string };

    expect(err).toMatchObject({
      name: 'PaymentProviderError',
      code: 'PAYMENT_FAILED',
      userMessage: 'Payment processing failed. Please try again.',
    });
    expect(err.userMessage).not.toContain('fetch failed');
  });

  it('passes existing PaymentProviderError instances through unchanged (no double-wrap)', async () => {
    // If the order-create succeeds but the payment-create rejects
    // with an already-typed PaymentProviderError, the catch must
    // re-throw it as-is.
    const original = new PaymentProviderError(
      'Your payment was declined. Please try a different card.',
      'PAYMENT_DECLINED',
      'do_not_honor',
    );
    mockPaymentsCreate.mockRejectedValue(original);

    const provider = new SquarePaymentProvider(99);
    await expect(
      provider.createOrderWithPayment(
        'cnon:typed', 2000, [{ catalogObjectId: 'sq_cat_var_1', quantity: '1' }],
        false, undefined, 'pat@example.com', 'idem-5',
      ),
    ).rejects.toBe(original);
  });

  it('passes ProviderNotConfiguredError through unchanged (no wrap into PAYMENT_FAILED)', async () => {
    // PNCE is raised from getSquareClient before the order is even
    // attempted, but the same passthrough invariant applies as
    // processPayment above — the route's PROVIDER_NOT_CONFIGURED
    // branch depends on it.
    mockStorage.getLocationSquareConfig.mockResolvedValue({
      accessToken: '',
      appId: '',
      locationId: '',
      environment: 'sandbox',
    });

    const provider = new SquarePaymentProvider(99);
    await expect(
      provider.createOrderWithPayment(
        'cnon:nope', 2000, [{ catalogObjectId: 'sq_cat_var_1', quantity: '1' }],
        false, undefined, 'pat@example.com', 'idem-6',
      ),
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    expect(mockOrdersCreate).not.toHaveBeenCalled();
    expect(mockPaymentsCreate).not.toHaveBeenCalled();
  });
});
