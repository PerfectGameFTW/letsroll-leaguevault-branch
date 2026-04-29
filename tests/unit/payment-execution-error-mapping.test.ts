/**
 * Task #605 — `executeCharge` and `executeChargeForLocation` (used by
 * the autopay job runner + scheduled charge path) must surface the
 * typed `PaymentProviderError.userMessage` (and the canonical
 * "provider not configured" sentence) on the returned `ChargeResult`,
 * not the raw `error.message` / "Unknown error".
 *
 * That guarantee underpins the failed-payment row's `notes` column
 * (see payment-lifecycle.ts) — admins reading "Failed payment: …"
 * need the actionable provider reason ("Your payment was declined.
 * Please try a different card.") rather than a leaked SDK string or
 * the location id from a PNCE.
 *
 * Both `lineItems.length > 0` (createOrderWithPayment) and
 * `lineItems.length === 0` (processPayment) branches must agree on
 * this contract — a regression on the no-line-items branch silently
 * leaked typed errors back to callers before this task wrapped both
 * paths through the shared helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaymentProvider } from '../../server/services/payment-provider';

vi.mock('../../server/logger', () => {
  const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: fakeLogger, createLogger: () => fakeLogger };
});

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

const { executeCharge, executeChargeForLocation } = await import(
  '../../server/services/payment-execution'
);
const { PaymentProviderError, ProviderNotConfiguredError } = await import(
  '../../server/services/payment-provider-factory'
);
const { PROVIDER_NOT_CONFIGURED_USER_MESSAGE } = await import(
  '../../server/utils/payment-error-response'
);

beforeEach(() => {
  mockGetPaymentProvider.mockReset();
});

function makeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  // Stub only the surface area `executeCharge` actually exercises —
  // the typed PaymentProvider interface has many other methods we
  // never reach in these tests, so the unused ones throw on call.
  const unused = (name: string) => async () => {
    throw new Error(`stub method ${name} should not be called in this test`);
  };
  const base: PaymentProvider = {
    providerName: 'square',
    locationId: 99,
    processPayment: vi.fn(),
    createOrderWithPayment: vi.fn(),
    refundPayment: unused('refundPayment'),
    saveCardOnFile: unused('saveCardOnFile'),
    listCardsOnFile: unused('listCardsOnFile'),
    disableCard: unused('disableCard'),
    createOrUpdateCustomer: unused('createOrUpdateCustomer'),
    getPayment: unused('getPayment'),
    validateCardId: () => true,
  };
  return Object.assign(base, overrides);
}

describe('executeCharge — typed error mapping (Task #605)', () => {
  describe('createOrderWithPayment branch (lineItems.length > 0)', () => {
    it('surfaces PaymentProviderError.userMessage on the ChargeResult', async () => {
      // The order branch was the first to be wrapped — pin that the
      // typed userMessage wins over the caller's "Unknown error"
      // fallback so the failed-payment row's notes carry the
      // actionable reason.
      const provider = makeProvider({
        createOrderWithPayment: vi.fn().mockRejectedValue(
          new PaymentProviderError(
            'Your payment was declined. Please try a different card.',
            'PAYMENT_DECLINED',
            'do_not_honor',
          ),
        ),
      });

      const res = await executeCharge(
        provider,
        'card_1',
        2000,
        [{ catalogObjectId: 'item_1', quantity: '1' }],
        'cust_1',
        'pat@example.com',
      );

      expect(res.status).toBe('error');
      expect(res.error).toBe('Your payment was declined. Please try a different card.');
      expect(res.providerName).toBe('square');
    });

    it('surfaces the canonical PNCE sentence (no location id leak)', async () => {
      const provider = makeProvider({
        createOrderWithPayment: vi.fn().mockRejectedValue(
          new ProviderNotConfiguredError('Square is not configured for location 99', 99),
        ),
      });

      const res = await executeCharge(
        provider,
        'card_1',
        2000,
        [{ catalogObjectId: 'item_1', quantity: '1' }],
        'cust_1',
        'pat@example.com',
      );

      expect(res.status).toBe('error');
      expect(res.error).toBe(PROVIDER_NOT_CONFIGURED_USER_MESSAGE);
      // The raw PNCE message must not appear — that's the point of
      // routing through the helper instead of `e.message`.
      expect(res.error).not.toContain('99');
    });
  });

  describe('processPayment branch (lineItems.length === 0)', () => {
    it('surfaces PaymentProviderError.userMessage on the ChargeResult', async () => {
      // This is the regression the task #605 review caught: before
      // wrapping this branch, a typed PaymentProviderError thrown
      // from processPayment propagated out raw — the autopay /
      // schedule executor would then either crash or log the leaked
      // SDK message instead of recording the actionable reason.
      const provider = makeProvider({
        processPayment: vi.fn().mockRejectedValue(
          new PaymentProviderError(
            'Your payment was declined. Please try a different card.',
            'PAYMENT_DECLINED',
            'do_not_honor',
          ),
        ),
      });

      const res = await executeCharge(provider, 'card_1', 2000, [], 'cust_1', 'pat@example.com');

      expect(res.status).toBe('error');
      expect(res.error).toBe('Your payment was declined. Please try a different card.');
      expect(res.providerName).toBe('square');
    });

    it('surfaces the canonical PNCE sentence (no location id leak)', async () => {
      const provider = makeProvider({
        processPayment: vi.fn().mockRejectedValue(
          new ProviderNotConfiguredError('Square is not configured for location 99', 99),
        ),
      });

      const res = await executeCharge(provider, 'card_1', 2000, [], 'cust_1', 'pat@example.com');

      expect(res.status).toBe('error');
      expect(res.error).toBe(PROVIDER_NOT_CONFIGURED_USER_MESSAGE);
      expect(res.error).not.toContain('99');
    });

    it('falls through to the sanitized fallback for an untyped Error', async () => {
      // An untyped throw must NOT leak its raw `error.message` (which
      // could be a stack-trace fragment) to the failed-payment row.
      // The sanitizer in the helper guarantees that.
      const provider = makeProvider({
        processPayment: vi.fn().mockRejectedValue(
          new Error('boom\n  at /server/services/foo.ts:1'),
        ),
      });

      const res = await executeCharge(provider, 'card_1', 2000, [], 'cust_1', 'pat@example.com');

      expect(res.status).toBe('error');
      // Multi-line messages are scrubbed by sanitizePaymentUserMessage
      // → the generic fallback sentence is used instead. The exact
      // sentence is owned by the sanitizer; the contract here is that
      // the raw "boom" / file-path text never leaks out.
      expect(res.error).not.toContain('boom');
      expect(res.error).not.toContain('foo.ts');
      expect(res.providerName).toBe('square');
    });
  });
});

describe('executeChargeForLocation — PNCE mapping (Task #605)', () => {
  it('returns the canonical PNCE sentence when getPaymentProvider rejects with PNCE', async () => {
    // PNCE is thrown from `getPaymentProvider` (not from
    // executeCharge itself) on the autopay path — the wrapper must
    // catch it and emit the unified message, never the raw
    // `e.message` (which embeds the location id).
    mockGetPaymentProvider.mockRejectedValue(
      new ProviderNotConfiguredError('Square is not configured for location 7', 7),
    );

    const res = await executeChargeForLocation('card_1', 2000, [], 7, 'cust_1', 'pat@example.com');

    expect(res.status).toBe('error');
    expect(res.error).toBe(PROVIDER_NOT_CONFIGURED_USER_MESSAGE);
    expect(res.error).not.toContain('7');
  });

  it('rethrows non-PNCE errors from getPaymentProvider so the caller sees them', async () => {
    // The wrapper only catches PNCE — any other failure from
    // getPaymentProvider (e.g. a database error reading the
    // location's credentials) must still propagate so the caller's
    // own catch path can decide what to do. Wrapping it in the
    // sanitized fallback here would silently swallow infrastructure
    // failures that should be loud.
    const dbErr = new Error('connection refused');
    mockGetPaymentProvider.mockRejectedValue(dbErr);

    await expect(
      executeChargeForLocation('card_1', 2000, [], 7, 'cust_1', 'pat@example.com'),
    ).rejects.toBe(dbErr);
  });
});
