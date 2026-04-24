/**
 * Shared row-locking sweep helper (task #361).
 *
 * After tasks #321 and #284 the codebase had two sweep services
 * (`payment-scheduler.ts > sweepTick` and
 * `payment-sync-retry.ts > runPaymentSyncRetrySweep`) implementing
 * nearly identical row-claim logic:
 *
 *   1. Open a transaction.
 *   2. Run a `SELECT count(*)` against the candidate predicate so we
 *      know how many rows would match if we could lock them all.
 *   3. Re-run the same predicate as `SELECT ... FOR UPDATE OF <table>
 *      SKIP LOCKED` to claim only rows no other worker holds.
 *   4. Subtract the two to get a "skipped due to lock contention"
 *      number for telemetry / log lines.
 *
 * Inlining that pattern in every sweep makes it easy to drift the
 * predicate between the count and the lock query (which silently
 * skews the contention number) and easy for a new sweep service to
 * forget step 2 entirely. This helper isolates the math and forces
 * callers to thread the same predicate through both queries via two
 * thin closures, while leaving the actual Drizzle query construction
 * (joins, projections, custom orderings) up to the caller — none of
 * the existing call sites use the same select shape, so a fully
 * "give me a table + a where" helper would be too rigid.
 *
 * The helper does NOT open the transaction itself: every existing
 * caller already does additional work in the same tx (lease-stamp
 * writes for sync-retry, future cleanup writes for new sweeps), and
 * a helper-owned tx would force them to nest transactions.
 */

export interface LockedSweepInput<T> {
  /**
   * Run a `select count(*)` against the candidate predicate inside
   * the caller's transaction. Must use the SAME predicate as
   * `lockMatching` — drift here silently skews the contention number.
   */
  countMatching: () => Promise<number>;
  /**
   * Run the lock query inside the caller's transaction. The query
   * MUST end with `.for('update', { of: <table>, skipLocked: true })`
   * — without `skipLocked` the helper's contention number is
   * meaningless (a contended row would block instead of being
   * skipped, so `rows.length` would always equal `totalMatching`).
   */
  lockMatching: () => Promise<T[]>;
}

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

export async function lockedSweep<T>(
  input: LockedSweepInput<T>,
): Promise<LockedSweepResult<T>> {
  const totalMatching = await input.countMatching();
  const rows = await input.lockMatching();
  const skippedByLock = Math.max(0, totalMatching - rows.length);
  return { rows, totalMatching, skippedByLock };
}
