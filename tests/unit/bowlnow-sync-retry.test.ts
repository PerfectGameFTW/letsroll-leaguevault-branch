/**
 * Unit tests for the background BowlNow-sync retry sweep (task #480).
 *
 * Mocks the storage layer, the db client, and `syncBowlerToBN` /
 * `isOrgBNConfigured` so the sweep can be exercised purely in memory.
 *
 * Cases mirror `payment-sync-retry.test.ts` plus the BowlNow-specific
 * `skippedNoConfig` path (org dropped its BN credentials between the
 * flag being set and the next sweep tick — clearing the flag prevents
 * the row from being scanned forever).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectErrorLog } from '../helpers/expected-error-logs';

const mockSelect = vi.fn();
const mockGetOrgIntegrations = vi.fn();
const mockSyncBowlerToBN = vi.fn();
const mockIsOrgBNConfigured = vi.fn();
// Updates that happen *inside* the candidate-claim transaction
// (lease-stamp of bn_sync_last_attempt_at). Mirrors `mockUpdateClaim`
// in payment-sync-retry.test.ts.
const mockUpdateClaim = vi.fn();
// Updates that happen *outside* the tx, one per candidate, when the
// sweep clears the flag (success / no-config) or bumps the attempt
// counter (failure / throw).
const mockPerRowUpdate = vi.fn();

function buildSelectChain(isCount: boolean) {
  return {
    from: () => ({
      where: (..._args: unknown[]) => {
        if (isCount) {
          return Promise.resolve(mockSelect()).then((rows) => [
            { total: Array.isArray(rows) ? rows.length : 0 },
          ]);
        }
        const chain = {
          for: (..._a: unknown[]) => mockSelect(),
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(mockSelect()).then(resolve, reject),
        };
        return chain;
      },
    }),
  };
}

const tx = {
  select: (projection?: Record<string, unknown>) =>
    buildSelectChain(projection !== undefined),
  update: (_table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (predicate: unknown) => {
        mockUpdateClaim({ values, predicate });
        return Promise.resolve();
      },
    }),
  }),
};

vi.mock('../../server/db', () => ({
  db: {
    select: (projection?: Record<string, unknown>) =>
      buildSelectChain(projection !== undefined),
    transaction: async <T,>(fn: (txArg: typeof tx) => Promise<T>) => fn(tx),
    // Per-row clear/bump runs OUTSIDE the tx via top-level `db.update`.
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (predicate: unknown) => {
          mockPerRowUpdate({ values, predicate });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock('../../server/storage', () => ({
  storage: {
    getOrgIntegrations: (...args: unknown[]) => mockGetOrgIntegrations(...args),
  },
}));

vi.mock('../../server/services/bowlnow', () => ({
  syncBowlerToBN: (...args: unknown[]) => mockSyncBowlerToBN(...args),
  isOrgBNConfigured: (...args: unknown[]) => mockIsOrgBNConfigured(...args),
}));

import {
  bnSyncBackoffMs,
  runBowlnowSyncRetrySweep,
} from '../../server/services/bowlnow-sync-retry';
import { BN_SYNC_MAX_ATTEMPTS } from '@shared/schema';

const NOW = new Date('2026-04-25T12:00:00.000Z');

function bowler(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    name: 'Pending Bowler',
    email: 'pending@example.com',
    phone: null,
    active: true,
    order: 0,
    organizationId: 3,
    paymentCustomerId: null,
    cloverCustomerId: null,
    paymentProviderLocationId: null,
    bnContactId: null,
    paymentSyncPendingAt: null,
    paymentSyncAttempts: 0,
    paymentSyncLastAttemptAt: null,
    bnSyncPendingAt: '2026-04-25T11:00:00.000Z',
    bnSyncAttempts: 0,
    bnSyncLastAttemptAt: null as string | null,
    ...overrides,
  };
}

beforeEach(() => {
  mockSelect.mockReset();
  mockGetOrgIntegrations.mockReset();
  mockSyncBowlerToBN.mockReset();
  mockIsOrgBNConfigured.mockReset();
  mockUpdateClaim.mockReset();
  mockPerRowUpdate.mockReset();
  // Default: org has BN configured. Individual tests override.
  mockIsOrgBNConfigured.mockReturnValue(true);
  mockGetOrgIntegrations.mockResolvedValue({ bowlnow: { enabled: true, apiKey: 'k' } });
});

afterEach(() => vi.clearAllMocks());

describe('bnSyncBackoffMs', () => {
  it('grows exponentially from one minute', () => {
    expect(bnSyncBackoffMs(0)).toBe(60_000);
    expect(bnSyncBackoffMs(1)).toBe(120_000);
    expect(bnSyncBackoffMs(2)).toBe(240_000);
    expect(bnSyncBackoffMs(4)).toBe(16 * 60_000);
  });

  it('clamps absurd attempt counts so we never overflow', () => {
    expect(bnSyncBackoffMs(99)).toBe(60_000 * Math.pow(2, 16));
    expect(bnSyncBackoffMs(-5)).toBe(60_000);
  });
});

describe('runBowlnowSyncRetrySweep', () => {
  it('skips bowlers whose backoff window has not elapsed', async () => {
    mockSelect.mockResolvedValue([
      bowler({
        bnSyncAttempts: 2,
        bnSyncLastAttemptAt: new Date(NOW.getTime() - 60_000).toISOString(),
      }),
    ]);

    const result = await runBowlnowSyncRetrySweep(NOW);

    expect(result.scanned).toBe(1);
    expect(result.skippedBackoff).toBe(1);
    expect(result.retried).toBe(0);
    expect(mockSyncBowlerToBN).not.toHaveBeenCalled();
  });

  it('retries an eligible bowler successfully and clears the flag', async () => {
    mockSelect.mockResolvedValue([
      bowler({
        bnSyncAttempts: 1,
        bnSyncLastAttemptAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
      }),
    ]);
    mockSyncBowlerToBN.mockResolvedValue({ success: true, contactId: 'bn_abc' });

    const result = await runBowlnowSyncRetrySweep(NOW);

    expect(result.scanned).toBe(1);
    expect(result.retried).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.pendingAgain).toBe(0);
    expect(mockSyncBowlerToBN).toHaveBeenCalledTimes(1);
    expect(mockSyncBowlerToBN).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ bowlnow: expect.objectContaining({ enabled: true }) }),
    );
    // One per-row update that clears the flag + resets attempts.
    expect(mockPerRowUpdate).toHaveBeenCalledTimes(1);
    const { values } = mockPerRowUpdate.mock.calls[0][0];
    expect(values).toEqual({ bnSyncPendingAt: null, bnSyncAttempts: 0 });
  });

  it('counts a failed retry as pendingAgain and bumps the attempt counter', async () => {
    mockSelect.mockResolvedValue([bowler({ bnSyncAttempts: 0 })]);
    mockSyncBowlerToBN.mockResolvedValue({ success: false, error: 'BowlNow 503' });

    const result = await runBowlnowSyncRetrySweep(NOW);

    expect(result.retried).toBe(1);
    expect(result.pendingAgain).toBe(1);
    expect(result.succeeded).toBe(0);
    // Per-row update bumped attempts (the value is a Drizzle SQL chunk
    // for `bn_sync_attempts + 1`, so just assert the property is set).
    expect(mockPerRowUpdate).toHaveBeenCalledTimes(1);
    expect(mockPerRowUpdate.mock.calls[0][0].values).toHaveProperty('bnSyncAttempts');
  });

  it('clears the flag (no-config) when the org dropped its BowlNow credentials between flag and tick', async () => {
    // Critical to prevent the row from being scanned forever when
    // BN can never succeed for this org. Mirrors the payment sweep's
    // skippedNoUser semantics for an analogous "can't possibly
    // succeed" scenario.
    mockSelect.mockResolvedValue([bowler({ id: 555 })]);
    mockIsOrgBNConfigured.mockReturnValue(false);
    mockGetOrgIntegrations.mockResolvedValue({ bowlnow: null });

    const result = await runBowlnowSyncRetrySweep(NOW);

    expect(result.scanned).toBe(1);
    expect(result.skippedNoConfig).toBe(1);
    expect(result.retried).toBe(0);
    expect(mockSyncBowlerToBN).not.toHaveBeenCalled();
    // Per-row clear of all three columns.
    expect(mockPerRowUpdate).toHaveBeenCalledTimes(1);
    expect(mockPerRowUpdate.mock.calls[0][0].values).toEqual({
      bnSyncPendingAt: null,
      bnSyncAttempts: 0,
      bnSyncLastAttemptAt: null,
    });
  });

  it('treats an unexpected throw as an error and bumps attempts so we eventually give up', async () => {
    // The sweep logs the unexpected throw at [ERROR] on purpose.
    expectErrorLog(/BowlNow-sync retry threw unexpectedly/);
    mockSelect.mockResolvedValue([
      bowler({ id: 100 }),
      bowler({ id: 101 }),
    ]);
    mockSyncBowlerToBN
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ success: true, contactId: 'bn_ok' });

    const result = await runBowlnowSyncRetrySweep(NOW);

    expect(result.errors).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.retried).toBe(2);
    // One bump (for the throw) + one clear (for the success) = 2 updates.
    expect(mockPerRowUpdate).toHaveBeenCalledTimes(2);
  });

  it('refuses to retry a bowler that already hit the attempts cap', async () => {
    // The SQL filter would normally exclude these, but the in-memory
    // guard keeps us safe if the row was raced past the cap between
    // the SELECT and the per-row dispatch.
    mockSelect.mockResolvedValue([
      bowler({ bnSyncAttempts: BN_SYNC_MAX_ATTEMPTS }),
    ]);

    const result = await runBowlnowSyncRetrySweep(NOW);

    expect(result.skippedMaxAttempts).toBe(1);
    expect(result.retried).toBe(0);
    expect(mockSyncBowlerToBN).not.toHaveBeenCalled();
  });

  it('claims locked rows by stamping bn_sync_last_attempt_at = NOW so a peer worker is fenced out', async () => {
    // Multi-process safety mirroring task #321 for the payment sweep.
    mockSelect.mockResolvedValue([
      bowler({ id: 100, bnSyncAttempts: 1 }),
      bowler({ id: 101, bnSyncAttempts: 1 }),
    ]);
    mockSyncBowlerToBN.mockResolvedValue({ success: true });

    await runBowlnowSyncRetrySweep(NOW);

    expect(mockUpdateClaim).toHaveBeenCalledTimes(1);
    const { values } = mockUpdateClaim.mock.calls[0][0];
    // Drizzle's `sql` template renders to an SQL chunk object;
    // verify only that we asked to set last_attempt_at to something
    // (NOW() in production), not the exact internal shape.
    expect(values).toHaveProperty('bnSyncLastAttemptAt');
    expect(values.bnSyncLastAttemptAt).not.toBeNull();
    expect(values.bnSyncLastAttemptAt).not.toBeUndefined();
  });

  it('does not write a claim update when no rows were locked', async () => {
    mockSelect.mockResolvedValue([]);
    const result = await runBowlnowSyncRetrySweep(NOW);
    expect(result.scanned).toBe(0);
    expect(mockUpdateClaim).not.toHaveBeenCalled();
    expect(mockPerRowUpdate).not.toHaveBeenCalled();
  });
});
