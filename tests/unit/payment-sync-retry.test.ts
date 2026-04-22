/**
 * Unit tests for the background payment-sync retry sweep (task #284).
 *
 * Mocks the storage layer and `syncBowlerForUser` so the sweep can be
 * exercised purely in memory.
 *
 * Cases:
 *   - sweep skips bowlers whose last attempt is still inside the
 *     exponential backoff window
 *   - sweep skips bowlers without a linked user (manual cleanup needed)
 *   - sweep retries an eligible bowler by calling syncBowlerForUser
 *     with the linked user's profile and reports success
 *   - sweep tolerates an unexpected throw without crashing the tick
 *   - paymentSyncBackoffMs grows exponentially and caps the exponent
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSelect = vi.fn();
const mockGetUserByBowlerId = vi.fn();

vi.mock('../../server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (..._args: unknown[]) => mockSelect(),
      }),
    }),
  },
}));

vi.mock('../../server/storage', () => ({
  storage: {
    getUserByBowlerId: (...args: unknown[]) => mockGetUserByBowlerId(...args),
  },
}));

const mockSyncBowlerForUser = vi.fn();

vi.mock('../../server/services/payment-customer-sync', async () => {
  const actual = await vi.importActual<typeof import('../../server/services/payment-customer-sync')>(
    '../../server/services/payment-customer-sync',
  );
  return {
    ...actual,
    syncBowlerForUser: (...args: unknown[]) => mockSyncBowlerForUser(...args),
  };
});

import {
  paymentSyncBackoffMs,
  runPaymentSyncRetrySweep,
} from '../../server/services/payment-sync-retry';
import { PAYMENT_SYNC_MAX_ATTEMPTS } from '../../server/services/payment-customer-sync';

const NOW = new Date('2026-04-22T12:00:00.000Z');

function bowler(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    name: 'Pending Bowler',
    email: 'pending@example.com',
    phone: null,
    active: true,
    order: 0,
    paymentCustomerId: null,
    cardpointeProfileId: null,
    bnContactId: null,
    paymentSyncPendingAt: '2026-04-22T11:00:00.000Z',
    paymentSyncAttempts: 0,
    paymentSyncLastAttemptAt: null as string | null,
    ...overrides,
  };
}

beforeEach(() => {
  mockSelect.mockReset();
  mockGetUserByBowlerId.mockReset();
  mockSyncBowlerForUser.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('paymentSyncBackoffMs', () => {
  it('grows exponentially from one minute', () => {
    expect(paymentSyncBackoffMs(0)).toBe(60_000);
    expect(paymentSyncBackoffMs(1)).toBe(120_000);
    expect(paymentSyncBackoffMs(2)).toBe(240_000);
    expect(paymentSyncBackoffMs(4)).toBe(16 * 60_000);
  });

  it('clamps absurd attempt counts so we never overflow', () => {
    expect(paymentSyncBackoffMs(99)).toBe(60_000 * Math.pow(2, 16));
    expect(paymentSyncBackoffMs(-5)).toBe(60_000);
  });
});

describe('runPaymentSyncRetrySweep', () => {
  it('skips bowlers whose backoff window has not elapsed', async () => {
    mockSelect.mockResolvedValue([
      bowler({
        paymentSyncAttempts: 2,
        paymentSyncLastAttemptAt: new Date(NOW.getTime() - 60_000).toISOString(),
      }),
    ]);

    const result = await runPaymentSyncRetrySweep(NOW);

    expect(result.scanned).toBe(1);
    expect(result.skippedBackoff).toBe(1);
    expect(result.retried).toBe(0);
    expect(mockSyncBowlerForUser).not.toHaveBeenCalled();
  });

  it('retries an eligible bowler and reports success', async () => {
    mockSelect.mockResolvedValue([
      bowler({
        paymentSyncAttempts: 1,
        paymentSyncLastAttemptAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
      }),
    ]);
    mockGetUserByBowlerId.mockResolvedValue({
      id: 9,
      name: 'Linked User',
      email: 'linked@example.com',
      phone: '5555550000',
      locationId: 7,
      organizationId: 3,
    });
    mockSyncBowlerForUser.mockResolvedValue('synced');

    const result = await runPaymentSyncRetrySweep(NOW);

    expect(result.scanned).toBe(1);
    expect(result.retried).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.pendingAgain).toBe(0);
    expect(mockSyncBowlerForUser).toHaveBeenCalledTimes(1);
    const [user, changed] = mockSyncBowlerForUser.mock.calls[0];
    expect(user).toMatchObject({ id: 9, bowlerId: 100, email: 'linked@example.com' });
    expect(changed).toEqual({ nameChanged: true, emailChanged: true, phoneChanged: true });
  });

  it('counts pending_retry results separately so ops can see persistent failures', async () => {
    mockSelect.mockResolvedValue([bowler({ paymentSyncAttempts: 0 })]);
    mockGetUserByBowlerId.mockResolvedValue({
      id: 9,
      name: 'Linked User',
      email: 'linked@example.com',
      phone: null,
      locationId: 7,
      organizationId: 3,
    });
    mockSyncBowlerForUser.mockResolvedValue('pending_retry');

    const result = await runPaymentSyncRetrySweep(NOW);

    expect(result.retried).toBe(1);
    expect(result.pendingAgain).toBe(1);
    expect(result.succeeded).toBe(0);
  });

  it('skips bowlers with no linked user and continues processing the rest', async () => {
    mockSelect.mockResolvedValue([
      bowler({ id: 100 }),
      bowler({ id: 101 }),
    ]);
    mockGetUserByBowlerId.mockImplementation(async (id: number) =>
      id === 100 ? undefined : { id: 9, name: 'L', email: 'l@x.io', phone: null, locationId: null, organizationId: 3 },
    );
    mockSyncBowlerForUser.mockResolvedValue('synced');

    const result = await runPaymentSyncRetrySweep(NOW);

    expect(result.scanned).toBe(2);
    expect(result.skippedNoUser).toBe(1);
    expect(result.retried).toBe(1);
    expect(result.succeeded).toBe(1);
  });

  it('treats an unexpected throw as an error and continues with the next bowler', async () => {
    mockSelect.mockResolvedValue([
      bowler({ id: 100 }),
      bowler({ id: 101 }),
    ]);
    mockGetUserByBowlerId.mockResolvedValue({
      id: 9, name: 'L', email: 'l@x.io', phone: null, locationId: null, organizationId: 3,
    });
    mockSyncBowlerForUser
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('synced');

    const result = await runPaymentSyncRetrySweep(NOW);

    expect(result.errors).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.retried).toBe(2);
  });

  it('refuses to retry a bowler that already hit the attempts cap', async () => {
    // The SQL filter would normally exclude these, but the in-memory
    // guard keeps us safe if the row was raced past the cap between
    // the SELECT and the per-row dispatch.
    mockSelect.mockResolvedValue([
      bowler({ paymentSyncAttempts: PAYMENT_SYNC_MAX_ATTEMPTS }),
    ]);

    const result = await runPaymentSyncRetrySweep(NOW);

    expect(result.skippedMaxAttempts).toBe(1);
    expect(result.retried).toBe(0);
    expect(mockGetUserByBowlerId).not.toHaveBeenCalled();
  });
});
