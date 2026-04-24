/**
 * Shared row-locking sweep helper (task #361).
 *
 * After tasks #321 and #284 the codebase had two sweep services
 * (`payment-scheduler.ts > sweepTick` and
 * `payment-sync-retry.ts > runPaymentSyncRetrySweep`) implementing
 * nearly identical row-claim logic:
 *
 *   1. Run a `SELECT count(*)` against the candidate predicate so we
 *      know how many rows would match if we could lock them all.
 *   2. Re-run the same predicate as `SELECT ... FOR UPDATE OF <table>
 *      SKIP LOCKED` to claim only rows no other worker holds.
 *   3. Subtract the two to get a "skipped due to lock contention"
 *      number for telemetry / log lines.
 *
 * Inlining that pattern in every sweep makes it easy to drift the
 * predicate between the count and the lock query (which silently
 * skews the contention number) and easy for a new sweep service to
 * forget step 1 entirely. This helper centralises the queries: the
 * caller passes a Drizzle table + a single `where` predicate and
 * the helper builds both the count query and the FOR UPDATE SKIP
 * LOCKED select itself, so drift is structurally impossible.
 *
 * The helper does NOT open the transaction — every existing caller
 * already does additional work in the same tx (lease-stamp writes
 * for sync-retry, future cleanup writes for new sweeps), and a
 * helper-owned tx would force them to nest transactions. Pass `db`
 * for non-transactional sweeps or the `tx` argument from
 * `db.transaction(async (tx) => ...)` to participate in an existing
 * transaction.
 */
import { count, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { db } from '../../db';

// Accept either the top-level `db` or a tx handle. Both expose the
// same `.select()` chain we need; we derive Tx from db.transaction's
// callback parameter so this stays in sync if Drizzle's typings move.
type Db = typeof db;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type SweepDb = Db | Tx;

export interface LockedSweepResult<T> {
  /** Rows this worker successfully locked (and is responsible for). */
  rows: T[];
  /** Total rows matching the predicate at count time. */
  totalMatching: number;
  /**
   * `totalMatching - rows.length`, clamped to >= 0. Non-zero means
   * one or more peer workers were holding locks on matching rows.
   */
  skippedByLock: number;
}

/**
 * Run the count + FOR UPDATE SKIP LOCKED sweep against `table` using
 * the same `where` predicate for both queries.
 *
 * The lock target defaults to `table` itself (which is what every
 * single-table sweep wants). If you're sweeping with a JOIN and
 * need to lock a different table than the FROM, use the explicit
 * count/lock query path instead — keeping the JOIN+lock-target
 * variant out of this helper keeps the simple-case API simple.
 */
export async function lockedSweep<T extends PgTable>(
  txOrDb: SweepDb,
  table: T,
  where: SQL,
): Promise<LockedSweepResult<T['$inferSelect']>> {
  // Two casts kept narrow and local:
  //   1. `txOrDb as Db` collapses the (db | tx) union onto the
  //      shared `.select()` chain — both sides expose the identical
  //      API at runtime but TypeScript can't see the union as one
  //      nominal type without a hint.
  //   2. `table as PgTable` strips the `TableLikeHasEmptySelection`
  //      conditional on Drizzle's `.from()`. The generic-T-derived
  //      return type still refines `rows` to `T['$inferSelect'][]`
  //      at every call site, so type safety at the boundary is
  //      preserved — the cast only widens what `.from()` itself
  //      sees, not what callers receive.
  const exec = txOrDb as Db;
  const tableArg = table as PgTable;

  const totalRow = await exec
    .select({ total: count() })
    .from(tableArg)
    .where(where);
  const totalMatching = totalRow[0]?.total ?? 0;

  const rows = (await exec
    .select()
    .from(tableArg)
    .where(where)
    .for('update', { of: tableArg, skipLocked: true })) as T['$inferSelect'][];

  const skippedByLock = Math.max(0, totalMatching - rows.length);
  return { rows, totalMatching, skippedByLock };
}
