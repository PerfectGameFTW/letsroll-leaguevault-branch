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

vi.mock('../../server/storage', () => ({
  storage: {
    getBowler: (...args: unknown[]) => mockGetBowler(...args),
    updateBowler: (...args: unknown[]) => mockUpdateBowler(...args),
    getLocationSquareConfig: (...args: unknown[]) => mockGetLocationSquareConfig(...args),
    getFirstSquareConfiguredLocation: (...args: unknown[]) => mockGetFirstSquareConfiguredLocation(...args),
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
  cardpointeProfileId: null,
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
