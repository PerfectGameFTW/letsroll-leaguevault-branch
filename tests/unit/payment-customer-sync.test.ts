/**
 * Unit tests for syncBowlerForUser (task #281).
 *
 * Mocks the storage layer and the payment provider factory so we can
 * assert state transitions without hitting the database or a real
 * payment provider.
 *
 * Cases:
 *   - provider not configured → 'skipped' (no flag flip)
 *   - generic provider failure → 'pending_retry' AND bowler row gets
 *     `paymentSyncPendingAt` set
 *   - successful sync → 'synced' AND a previously-set `paymentSyncPendingAt`
 *     is cleared
 *   - user has no linked bowler → 'not_applicable'
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetBowler = vi.fn();
const mockUpdateBowler = vi.fn();
const mockGetLocationSquareConfig = vi.fn();
const mockGetFirstSquareConfiguredLocation = vi.fn();
const mockGetOrgIntegrations = vi.fn();

vi.mock('../../server/storage', () => ({
  storage: {
    getBowler: (...args: unknown[]) => mockGetBowler(...args),
    updateBowler: (...args: unknown[]) => mockUpdateBowler(...args),
    getLocationSquareConfig: (...args: unknown[]) => mockGetLocationSquareConfig(...args),
    getFirstSquareConfiguredLocation: (...args: unknown[]) => mockGetFirstSquareConfiguredLocation(...args),
    getOrgIntegrations: (...args: unknown[]) => mockGetOrgIntegrations(...args),
  },
}));

const mockGetPaymentProvider = vi.fn();

vi.mock('../../server/services/payment-provider-factory', async () => {
  const actual = await vi.importActual<typeof import('../../server/services/payment-provider-factory')>(
    '../../server/services/payment-provider-factory',
  );
  return {
    ...actual,
    getPaymentProvider: (...args: unknown[]) => mockGetPaymentProvider(...args),
  };
});

// BN side (task #480 architect review): the helper now inspects
// `syncBowlerToBN`'s `{success, error}` return value and queues
// failures for the retry sweep via `flagBowlerForBnRetry`. Defaults:
// `isOrgBNConfigured` returns false so existing tests that don't
// care about BN don't accidentally enter the BN branch; the failure
// test below overrides both.
const mockSyncBowlerToBN = vi.fn();
const mockIsOrgBNConfigured = vi.fn();
vi.mock('../../server/services/bowlnow', () => ({
  syncBowlerToBN: (...args: unknown[]) => mockSyncBowlerToBN(...args),
  isOrgBNConfigured: (...args: unknown[]) => mockIsOrgBNConfigured(...args),
}));

const mockFlagBowlerForBnRetry = vi.fn();
const mockClearBowlerBnRetry = vi.fn();
vi.mock('../../server/services/bowlnow-retry-flag', () => ({
  flagBowlerForBnRetry: (...args: unknown[]) => mockFlagBowlerForBnRetry(...args),
  clearBowlerBnRetry: (...args: unknown[]) => mockClearBowlerBnRetry(...args),
}));

import { syncBowlerForUser, type SyncableUser } from '../../server/services/payment-customer-sync';
import { ProviderNotConfiguredError } from '../../server/services/payment-provider-factory';

const baseUser: SyncableUser = {
  id: 1,
  bowlerId: 42,
  name: 'Jane Bowler',
  email: 'jane@example.com',
  phone: '5555550100',
  locationId: 7,
  organizationId: 3,
};

const baseBowler = {
  id: 42,
  name: 'Jane Bowler',
  email: 'jane@example.com',
  phone: '5555550100',
  active: true,
  order: 0,
  paymentCustomerId: null as string | null,
  cloverCustomerId: null,
  bnContactId: null,
  paymentSyncPendingAt: null as string | null,
};

const allChanged = { nameChanged: true, emailChanged: true, phoneChanged: true };

beforeEach(() => {
  mockGetBowler.mockReset();
  mockUpdateBowler.mockReset();
  mockGetLocationSquareConfig.mockReset();
  mockGetFirstSquareConfiguredLocation.mockReset();
  mockGetPaymentProvider.mockReset();
  mockGetOrgIntegrations.mockReset();
  mockSyncBowlerToBN.mockReset();
  mockIsOrgBNConfigured.mockReset();
  mockFlagBowlerForBnRetry.mockReset();
  mockClearBowlerBnRetry.mockReset();
  // Default: org has NO BN configured, so the BN branch is a no-op
  // for tests that only care about Square. The dedicated BN-failure
  // test below overrides this.
  mockIsOrgBNConfigured.mockReturnValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('syncBowlerForUser', () => {
  it('returns not_applicable when the user has no linked bowler', async () => {
    const status = await syncBowlerForUser({ ...baseUser, bowlerId: null }, allChanged);
    expect(status).toBe('not_applicable');
    expect(mockGetBowler).not.toHaveBeenCalled();
  });

  it('returns skipped when the provider is not configured for the location', async () => {
    mockGetBowler.mockResolvedValue(baseBowler);
    mockGetLocationSquareConfig.mockResolvedValue({ accessToken: 'live-token' });
    mockGetPaymentProvider.mockRejectedValue(
      new ProviderNotConfiguredError('no creds', 7),
    );

    const status = await syncBowlerForUser(baseUser, allChanged);

    expect(status).toBe('skipped');
    // No retry flag should be set on a config-skip — value stays null/undefined,
    // never a real timestamp string.
    const updateCalls = mockUpdateBowler.mock.calls;
    for (const call of updateCalls) {
      const flag = call[1].paymentSyncPendingAt;
      expect(flag === null || flag === undefined).toBe(true);
    }
  });

  it('flips paymentSyncPendingAt and returns pending_retry on a generic provider failure', async () => {
    mockGetBowler.mockResolvedValue(baseBowler);
    mockGetLocationSquareConfig.mockResolvedValue({ accessToken: 'live-token' });
    mockUpdateBowler.mockResolvedValue(baseBowler);
    mockGetPaymentProvider.mockResolvedValue({
      createOrUpdateCustomer: vi.fn().mockRejectedValue(new Error('Square 503: gateway timeout')),
    });

    const status = await syncBowlerForUser(baseUser, allChanged);

    expect(status).toBe('pending_retry');
    // Final updateBowler call should set the retry flag
    const lastCall = mockUpdateBowler.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![0]).toBe(42);
    expect(lastCall![1].paymentSyncPendingAt).toEqual(expect.any(String));
  });

  it('clears paymentSyncPendingAt and returns synced on a successful sync', async () => {
    const previouslyFailedBowler = {
      ...baseBowler,
      paymentSyncPendingAt: '2026-04-20T12:00:00.000Z',
    };
    mockGetBowler.mockResolvedValue(previouslyFailedBowler);
    mockGetLocationSquareConfig.mockResolvedValue({ accessToken: 'live-token' });
    mockUpdateBowler.mockResolvedValue(previouslyFailedBowler);
    mockGetPaymentProvider.mockResolvedValue({
      createOrUpdateCustomer: vi.fn().mockResolvedValue({ id: 'cust_123' }),
    });

    const status = await syncBowlerForUser(baseUser, allChanged);

    expect(status).toBe('synced');
    // Final updateBowler call should null out the retry flag
    const lastCall = mockUpdateBowler.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    expect(lastCall![1].paymentSyncPendingAt).toBeNull();
    expect(lastCall![1].paymentCustomerId).toBe('cust_123');
  });

  it('queues the bowler for the BN retry sweep when BN sync returns success:false during a Square-successful flow', async () => {
    // Architect review on #480: previously, a `{success:false}` from
    // `syncBowlerToBN` here was logged-only — it didn't flip
    // `bn_sync_pending_at`, so the background BN-sync sweep never
    // picked the bowler up. Without this fix, a transient BN 5xx
    // during a profile update silently leaves the bowler's BN contact
    // stale until the next manual sync-all.
    mockGetBowler.mockResolvedValue(baseBowler);
    mockGetLocationSquareConfig.mockResolvedValue({ accessToken: 'live-token' });
    mockUpdateBowler.mockResolvedValue(baseBowler);
    mockGetPaymentProvider.mockResolvedValue({
      createOrUpdateCustomer: vi.fn().mockResolvedValue({ id: 'cust_999' }),
    });
    mockGetOrgIntegrations.mockResolvedValue({ bowlnow: { enabled: true, apiKey: 'k' } });
    mockIsOrgBNConfigured.mockReturnValue(true);
    mockSyncBowlerToBN.mockResolvedValue({ success: false, error: 'BowlNow 503' });

    const status = await syncBowlerForUser(baseUser, allChanged);

    // Square side still wins — Square is the source of truth for the
    // top-level status here; BN is best-effort but flagged for retry.
    expect(status).toBe('synced');
    expect(mockSyncBowlerToBN).toHaveBeenCalledTimes(1);
    expect(mockFlagBowlerForBnRetry).toHaveBeenCalledTimes(1);
    expect(mockFlagBowlerForBnRetry).toHaveBeenCalledWith(42);
  });

  it('queues the bowler for the BN retry sweep when syncBowlerToBN throws', async () => {
    mockGetBowler.mockResolvedValue(baseBowler);
    mockGetLocationSquareConfig.mockResolvedValue({ accessToken: 'live-token' });
    mockUpdateBowler.mockResolvedValue(baseBowler);
    mockGetPaymentProvider.mockResolvedValue({
      createOrUpdateCustomer: vi.fn().mockResolvedValue({ id: 'cust_999' }),
    });
    mockGetOrgIntegrations.mockResolvedValue({ bowlnow: { enabled: true, apiKey: 'k' } });
    mockIsOrgBNConfigured.mockReturnValue(true);
    mockSyncBowlerToBN.mockRejectedValue(new Error('connect ETIMEDOUT'));

    const status = await syncBowlerForUser(baseUser, allChanged);

    expect(status).toBe('synced');
    expect(mockFlagBowlerForBnRetry).toHaveBeenCalledTimes(1);
    expect(mockFlagBowlerForBnRetry).toHaveBeenCalledWith(42);
  });

  it('clears BN retry state and does NOT queue when syncBowlerToBN succeeds (rescues stuck-at-max rows)', async () => {
    // Architect review on #480 (round 2): a row that previously hit
    // BN_SYNC_MAX_ATTEMPTS would otherwise stay flagged forever
    // because the sweep's `attempts < cap` filter excludes it. A
    // foreground success must reset the retry state symmetrically.
    mockGetBowler.mockResolvedValue(baseBowler);
    mockGetLocationSquareConfig.mockResolvedValue({ accessToken: 'live-token' });
    mockUpdateBowler.mockResolvedValue(baseBowler);
    mockGetPaymentProvider.mockResolvedValue({
      createOrUpdateCustomer: vi.fn().mockResolvedValue({ id: 'cust_999' }),
    });
    mockGetOrgIntegrations.mockResolvedValue({ bowlnow: { enabled: true, apiKey: 'k' } });
    mockIsOrgBNConfigured.mockReturnValue(true);
    mockSyncBowlerToBN.mockResolvedValue({ success: true, contactId: 'bn_ok' });

    await syncBowlerForUser(baseUser, allChanged);

    expect(mockSyncBowlerToBN).toHaveBeenCalledTimes(1);
    expect(mockFlagBowlerForBnRetry).not.toHaveBeenCalled();
    expect(mockClearBowlerBnRetry).toHaveBeenCalledTimes(1);
    expect(mockClearBowlerBnRetry).toHaveBeenCalledWith(42);
  });

  it('returns skipped when the user has no email even if a bowler is linked', async () => {
    mockGetBowler.mockResolvedValue(baseBowler);
    mockUpdateBowler.mockResolvedValue(baseBowler);

    const status = await syncBowlerForUser(
      { ...baseUser, email: null },
      allChanged,
    );

    expect(status).toBe('skipped');
    expect(mockGetPaymentProvider).not.toHaveBeenCalled();
  });
});
