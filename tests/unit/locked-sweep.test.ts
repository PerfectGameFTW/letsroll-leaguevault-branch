/**
 * Unit tests for the shared row-locking sweep helper (task #361).
 *
 * The helper itself is intentionally tiny — its value is in
 * guaranteeing the count→lock→diff math is consistent across every
 * sweep service. These tests pin that math:
 *
 *   - rows.length === totalMatching → skippedByLock === 0
 *   - rows.length <  totalMatching → skippedByLock === diff
 *   - rows.length >  totalMatching (count was stale) → clamped to 0
 *   - countMatching is awaited before lockMatching (ordering matters
 *     so the count predicate sees the same snapshot the lock will)
 *   - both closures are invoked exactly once per sweep
 *   - errors from either closure propagate (no silent swallowing)
 */
import { describe, expect, it, vi } from 'vitest';

import { lockedSweep } from '../../server/services/_internal/locked-sweep';

describe('lockedSweep', () => {
  it('returns skippedByLock=0 when every matching row was locked', async () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = await lockedSweep({
      countMatching: async () => 3,
      lockMatching: async () => rows,
    });

    expect(result).toEqual({
      rows,
      totalMatching: 3,
      skippedByLock: 0,
    });
  });

  it('reports the correct diff when peers held some rows', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const result = await lockedSweep({
      countMatching: async () => 5,
      lockMatching: async () => rows,
    });

    expect(result.rows).toBe(rows);
    expect(result.totalMatching).toBe(5);
    expect(result.skippedByLock).toBe(3);
  });

  it('clamps skippedByLock to 0 when the count was stale (locked > total)', async () => {
    // In practice this happens if a row gets inserted between the
    // count and the lock query — the lock query then returns more
    // rows than the count saw. Returning a negative contention
    // number would be confusing in dashboards/log lines, so the
    // helper clamps.
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = await lockedSweep({
      countMatching: async () => 1,
      lockMatching: async () => rows,
    });

    expect(result.totalMatching).toBe(1);
    expect(result.rows).toBe(rows);
    expect(result.skippedByLock).toBe(0);
  });

  it('handles the empty-candidate case', async () => {
    const result = await lockedSweep({
      countMatching: async () => 0,
      lockMatching: async () => [],
    });

    expect(result).toEqual({
      rows: [],
      totalMatching: 0,
      skippedByLock: 0,
    });
  });

  it('awaits countMatching before lockMatching and invokes each exactly once', async () => {
    const order: string[] = [];
    const countMatching = vi.fn(async () => {
      order.push('count-start');
      await Promise.resolve();
      order.push('count-end');
      return 2;
    });
    const lockMatching = vi.fn(async () => {
      order.push('lock-start');
      await Promise.resolve();
      order.push('lock-end');
      return [{ id: 'a' }, { id: 'b' }];
    });

    await lockedSweep({ countMatching, lockMatching });

    expect(countMatching).toHaveBeenCalledTimes(1);
    expect(lockMatching).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['count-start', 'count-end', 'lock-start', 'lock-end']);
  });

  it('propagates errors from countMatching without invoking lockMatching', async () => {
    const lockMatching = vi.fn(async () => []);
    await expect(
      lockedSweep({
        countMatching: async () => {
          throw new Error('count exploded');
        },
        lockMatching,
      }),
    ).rejects.toThrow('count exploded');
    expect(lockMatching).not.toHaveBeenCalled();
  });

  it('propagates errors from lockMatching', async () => {
    await expect(
      lockedSweep({
        countMatching: async () => 1,
        lockMatching: async () => {
          throw new Error('lock exploded');
        },
      }),
    ).rejects.toThrow('lock exploded');
  });
});
