/**
 * Task #649 — Make 'wrong card' error consistent across Square and Clover.
 *
 * Square's `disableCard` (task #620) lists the customer's saved cards
 * first and throws the typed `CardOwnershipMismatchError` when the
 * caller-supplied `cardId` isn't on that customer's vault. The DELETE
 * `/api/payments-provider/cards/:bowlerId/:cardId` route matches that
 * typed class via `instanceof` and returns a dedicated 403 envelope
 * with the message "Card does not belong to this customer".
 *
 * Pre-#649 Clover's `disableCard` skipped the same pre-check and
 * forwarded straight to `deleteCustomerSource`, so the same caller
 * bug on a Clover location surfaced as a generic Clover not-found
 * error mapped to a 500 PaymentProviderError — a different (and less
 * actionable) response shape than Square locations got for the exact
 * same bug.
 *
 * These tests pin Clover's parity with Square at the provider level:
 *
 *   - Tenancy violation (`cardId` not on the customer's vault) →
 *     `CardOwnershipMismatchError`. The same DELETE route the Square
 *     test exercises in `cards-disable-ownership-mismatch.test.ts`
 *     therefore returns 403 for Clover locations too.
 *   - Happy path (`cardId` IS on the vault) → the underlying
 *     `deleteCustomerSource` is invoked exactly once and no error
 *     escapes.
 *   - Underlying list failure → still routed through `mapApiError`
 *     into a `PaymentProviderError` (NOT swallowed as an ownership
 *     mismatch), so legitimate Clover outages keep their generic
 *     500 mapping instead of being mis-flagged as a 403 tenancy
 *     violation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockListCustomerSources = vi.fn();
const mockDeleteCustomerSource = vi.fn();

vi.mock('../../server/services/clover', async () => {
  const actual = await vi.importActual<
    typeof import('../../server/services/clover')
  >('../../server/services/clover');
  return {
    ...actual,
    listCustomerSources: (...a: unknown[]) => mockListCustomerSources(...a),
    deleteCustomerSource: (...a: unknown[]) => mockDeleteCustomerSource(...a),
  };
});

const mockGetLocationCloverConfig = vi.fn();
vi.mock('../../server/storage', () => ({
  storage: {
    getLocationCloverConfig: (...a: unknown[]) =>
      mockGetLocationCloverConfig(...a),
  },
}));

// eslint-disable-next-line local/factory-must-use-schema -- mocked logger, not a schema row
const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../server/logger', () => ({
  logger: fakeLogger,
  createLogger: () => fakeLogger,
}));

const { CloverPaymentProvider } = await import(
  '../../server/services/clover-provider'
);
const {
  CardOwnershipMismatchError,
  PaymentProviderError,
} = await import('../../server/services/payment-provider-factory');
const { CloverApiError } = await import('../../server/services/clover');

beforeEach(() => {
  mockListCustomerSources.mockReset();
  mockDeleteCustomerSource.mockReset();
  mockGetLocationCloverConfig.mockReset();
  mockGetLocationCloverConfig.mockResolvedValue({
    apiToken: 'tok_test',
    merchantId: 'mer_test',
    environment: 'sandbox',
  });
});

afterEach(() => vi.clearAllMocks());

describe('CloverPaymentProvider.disableCard — typed ownership-mismatch parity (Task #649)', () => {
  it('throws CardOwnershipMismatchError when the cardId is not on the customer vault', async () => {
    // Vault contains two cards; caller asks to delete a third id.
    // Pre-#649 this would have hit deleteCustomerSource and bubbled
    // up as a generic 500 PaymentProviderError. Post-#649 the
    // pre-check throws the typed class so the DELETE route returns
    // the same 403 envelope Square already returned.
    mockListCustomerSources.mockResolvedValue([
      { id: 'cv_owned_1', last4: '1111' },
      { id: 'cv_owned_2', last4: '2222' },
    ]);

    const provider = new CloverPaymentProvider(99);
    await expect(
      provider.disableCard('cv_someone_elses', 'cust_test'),
    ).rejects.toBeInstanceOf(CardOwnershipMismatchError);

    // The delete must NOT have been issued — the whole point of the
    // pre-check is to fail closed before touching Clover state.
    expect(mockDeleteCustomerSource).not.toHaveBeenCalled();
  });

  it('proceeds to deleteCustomerSource exactly once when the cardId IS on the customer vault', async () => {
    mockListCustomerSources.mockResolvedValue([
      { id: 'cv_owned_1', last4: '1111' },
      { id: 'cv_owned_target', last4: '4242' },
    ]);
    mockDeleteCustomerSource.mockResolvedValue(undefined);

    const provider = new CloverPaymentProvider(99);
    await provider.disableCard('cv_owned_target', 'cust_test');

    expect(mockDeleteCustomerSource).toHaveBeenCalledTimes(1);
    const args = mockDeleteCustomerSource.mock.calls[0];
    expect(args[1]).toBe('cust_test');
    expect(args[2]).toBe('cv_owned_target');
  });

  it('routes a real list-cards Clover outage into PaymentProviderError (not CardOwnershipMismatchError)', async () => {
    // A 502 from Clover's "list cards" endpoint must NOT be silently
    // re-mapped to the typed ownership class — that would mis-flag a
    // legitimate provider outage as a caller-side tenancy bug. The
    // existing `mapApiError` branch is what should win, so the
    // route's shared fallback envelope (500 + "Failed to remove card"
    // + CARD_REMOVAL_FAILED) keeps signaling a generic provider
    // failure to admins.
    mockListCustomerSources.mockRejectedValue(
      new CloverApiError('Bad Gateway', 502, 'upstream'),
    );

    const provider = new CloverPaymentProvider(99);
    await expect(
      provider.disableCard('cv_any', 'cust_test'),
    ).rejects.toBeInstanceOf(PaymentProviderError);
    await expect(
      provider.disableCard('cv_any', 'cust_test'),
    ).rejects.not.toBeInstanceOf(CardOwnershipMismatchError);

    expect(mockDeleteCustomerSource).not.toHaveBeenCalled();
  });
});
