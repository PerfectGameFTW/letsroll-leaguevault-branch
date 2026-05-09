/**
 * Unit tests for the shared row-locking sweep helper (task #361).
 *
 * The helper takes a Drizzle table + a single `where` predicate and
 * runs both `SELECT count(*)` and `SELECT … FOR UPDATE OF <table>
 * SKIP LOCKED` against the same table+predicate, so callers can't
 * silently drift one query from the other. These tests pin both the
 * arithmetic (count - locked = skippedByLock) and the structural
 * contract (count + lock issued against the SAME table & predicate,
 * lock query uses FOR UPDATE SKIP LOCKED with `of: <table>`).
 */
import { describe, expect, it, vi } from 'vitest';

// `lockedSweep` imports `db` from `../db` purely for its TYPE (to
// derive the SweepDb union). The mock keeps that side-effectful
// import a no-op so this test stays in-memory.
vi.mock('../../server/db', () => ({
  db: {
    transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn({}),
  },
}));

import { lockedSweep } from '../../server/services/_internal/locked-sweep';

// A fake Drizzle "table" — the helper passes it straight through to
// `.from()` and `.for('update', { of: <table>, … })`, so any shape
// works as long as the test asserts on object identity.
// eslint-disable-next-line local/factory-must-use-schema -- brand sentinel, not a schema row
const fakeTable = { __brand: 'fake-table' } as unknown as Parameters<typeof lockedSweep>[1];
// eslint-disable-next-line local/factory-must-use-schema -- brand sentinel, not a schema row
const fakePredicate = { __brand: 'fake-predicate' } as unknown as Parameters<typeof lockedSweep>[2];

interface SelectCall {
  projection: Record<string, unknown> | undefined;
  from: unknown;
  where: unknown;
  forArgs: unknown[] | null;
}

function buildFakeDb(opts: {
  countResult: number;
  lockedRows: unknown[];
}) {
  const calls: SelectCall[] = [];
  const db = {
    select(projection?: Record<string, unknown>) {
      const call: SelectCall = {
        projection,
        from: undefined,
        where: undefined,
        forArgs: null,
      };
      calls.push(call);
      const isCount = projection !== undefined;
      return {
        from(table: unknown) {
          call.from = table;
          return {
            where(predicate: unknown) {
              call.where = predicate;
              if (isCount) {
                return Promise.resolve([{ total: opts.countResult }]);
              }
              const lockChain = {
                for(...args: unknown[]) {
                  call.forArgs = args;
                  return Promise.resolve(opts.lockedRows);
                },
              };
              return lockChain;
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

describe('lockedSweep', () => {
  it('returns skippedByLock=0 when every matching row was locked', async () => {
    const lockedRows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { db } = buildFakeDb({ countResult: 3, lockedRows });

    const result = await lockedSweep(db as never, fakeTable, fakePredicate);

    expect(result).toEqual({
      rows: lockedRows,
      totalMatching: 3,
      skippedByLock: 0,
    });
  });

  it('reports the correct diff when peers held some rows', async () => {
    const lockedRows = [{ id: 1 }, { id: 2 }];
    const { db } = buildFakeDb({ countResult: 5, lockedRows });

    const result = await lockedSweep(db as never, fakeTable, fakePredicate);

    expect(result.rows).toBe(lockedRows);
    expect(result.totalMatching).toBe(5);
    expect(result.skippedByLock).toBe(3);
  });

  it('clamps skippedByLock to 0 when the count was stale (locked > total)', async () => {
    // Happens if a row gets inserted between the count and the lock
    // query — the lock query then returns more rows than the count
    // saw. Returning a negative contention number would be confusing
    // in dashboards/log lines, so the helper clamps.
    const lockedRows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { db } = buildFakeDb({ countResult: 1, lockedRows });

    const result = await lockedSweep(db as never, fakeTable, fakePredicate);

    expect(result.totalMatching).toBe(1);
    expect(result.rows).toBe(lockedRows);
    expect(result.skippedByLock).toBe(0);
  });

  it('handles the empty-candidate case', async () => {
    const { db } = buildFakeDb({ countResult: 0, lockedRows: [] });

    const result = await lockedSweep(db as never, fakeTable, fakePredicate);

    expect(result).toEqual({
      rows: [],
      totalMatching: 0,
      skippedByLock: 0,
    });
  });

  it('issues count and lock against the SAME table and predicate', async () => {
    // Structural guarantee: the whole point of the helper is that a
    // caller can't accidentally count one predicate and lock another.
    const { db, calls } = buildFakeDb({ countResult: 2, lockedRows: [{ id: 1 }, { id: 2 }] });

    await lockedSweep(db as never, fakeTable, fakePredicate);

    expect(calls).toHaveLength(2);
    const [countCall, lockCall] = calls;
    expect(countCall.projection).toEqual({ total: expect.anything() });
    expect(countCall.from).toBe(fakeTable);
    expect(countCall.where).toBe(fakePredicate);
    expect(lockCall.projection).toBeUndefined();
    expect(lockCall.from).toBe(fakeTable);
    expect(lockCall.where).toBe(fakePredicate);
  });

  it("issues the lock query as FOR UPDATE OF <table> SKIP LOCKED", async () => {
    const { db, calls } = buildFakeDb({ countResult: 1, lockedRows: [{ id: 1 }] });

    await lockedSweep(db as never, fakeTable, fakePredicate);

    const lockCall = calls[1];
    expect(lockCall.forArgs).toEqual([
      'update',
      { of: fakeTable, skipLocked: true },
    ]);
  });

  it('runs the count query before the lock query', async () => {
    // Order matters: the count is the snapshot the contention math
    // is computed against. A reversed order would let the count see
    // an inflated set if a peer commits between the two queries.
    const order: string[] = [];
    const db = {
      select(projection?: Record<string, unknown>) {
        const isCount = projection !== undefined;
        return {
          from() {
            return {
              where() {
                if (isCount) {
                  order.push('count');
                  return Promise.resolve([{ total: 1 }]);
                }
                return {
                  for() {
                    order.push('lock');
                    return Promise.resolve([{ id: 1 }]);
                  },
                };
              },
            };
          },
        };
      },
    };

    await lockedSweep(db as never, fakeTable, fakePredicate);
    expect(order).toEqual(['count', 'lock']);
  });

  it('falls back to totalMatching=0 if the count row is missing', async () => {
    // Defensive: a count query should always return one row, but if
    // a future driver ever returns [] we don't want NaN telemetry.
    const db = {
      select(projection?: Record<string, unknown>) {
        const isCount = projection !== undefined;
        return {
          from() {
            return {
              where() {
                if (isCount) return Promise.resolve([]);
                return { for: () => Promise.resolve([]) };
              },
            };
          },
        };
      },
    };

    const result = await lockedSweep(db as never, fakeTable, fakePredicate);
    expect(result.totalMatching).toBe(0);
    expect(result.skippedByLock).toBe(0);
  });
});
