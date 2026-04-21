import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerterState } from "@shared/schema";

/**
 * Atomically attempt to claim the next alert slot for `kind`. Used by
 * out-of-band alerters (e.g. Apple Pay recovery) to enforce a min
 * interval between sends across all instances and across process
 * restarts.
 *
 * Concurrency model: a SELECT ... FOR UPDATE inside a transaction
 * serializes concurrent claimers on the row (or, for first-ever
 * inserts, on the unique-violation path of an INSERT). Whichever
 * caller wins reads the previous `last_sent_at`, decides whether
 * the window has elapsed, and writes its result inside the same
 * transaction — so two instances racing on boot cannot both send
 * within the configured interval.
 *
 * Returns:
 *  - `claimed`: true if the slot was acquired (caller should send the
 *    alert). On `claimed=true`, `suppressedCount` is the number of
 *    attempts that were rate-limited since the previous successful
 *    claim, so the alert can include that context.
 *  - `claimed=false` means the previous send is still inside the
 *    rate-limit window; the suppressed counter has been incremented
 *    and `suppressedCount` reflects the new total.
 */
export async function tryClaimAlerterSlot(
  kind: string,
  minIntervalMs: number,
): Promise<{ claimed: boolean; suppressedCount: number }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(alerterState)
      .where(eq(alerterState.kind, kind))
      .for("update")
      .limit(1);

    const now = new Date();

    if (existing.length === 0) {
      await tx.insert(alerterState).values({
        kind,
        lastSentAt: now,
        suppressedCount: 0,
      });
      return { claimed: true, suppressedCount: 0 };
    }

    const row = existing[0];
    const elapsed = now.getTime() - row.lastSentAt.getTime();

    if (elapsed >= minIntervalMs) {
      const suppressed = row.suppressedCount;
      await tx
        .update(alerterState)
        .set({ lastSentAt: now, suppressedCount: 0 })
        .where(eq(alerterState.kind, kind));
      return { claimed: true, suppressedCount: suppressed };
    }

    const newSuppressed = row.suppressedCount + 1;
    await tx
      .update(alerterState)
      .set({ suppressedCount: newSuppressed })
      .where(eq(alerterState.kind, kind));
    return { claimed: false, suppressedCount: newSuppressed };
  });
}
