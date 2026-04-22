import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerterState, type AlerterSummary } from "@shared/schema";

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

/**
 * Persist the most recent alert payload for `kind`. Called by the
 * alerter immediately after a successful send so the admin in-app
 * banner has a description to display ("N items recovered at HH:MM").
 *
 * Does nothing if no row exists for `kind` yet — the row is always
 * created by `tryClaimAlerterSlot` first.
 */
export async function recordAlerterSummary(
  kind: string,
  summary: AlerterSummary,
): Promise<void> {
  // Write the summary and the successful-send timestamp atomically so
  // the admin banner endpoint never sees a new timestamp paired with
  // an older summary (#272).
  await db
    .update(alerterState)
    .set({ lastSummary: summary, lastSummarySentAt: new Date() })
    .where(eq(alerterState.kind, kind));
}

/**
 * Return the most recent *successful* alert event for `kind`, but only
 * if it was sent within the last `withinMs` window. Used by the admin
 * dashboard to decide whether to surface the recovery banner.
 *
 * Driven by `lastSummarySentAt` (set by `recordAlerterSummary` on a
 * successful send), not by `lastSentAt` — the latter is advanced when
 * the rate-limit slot is claimed, before the send result is known, so
 * using it would surface failed-send attempts as "recent alerts".
 */
export async function getRecentAlerterEvent(
  kind: string,
  withinMs: number,
): Promise<{ lastSentAt: Date; summary: AlerterSummary | null } | null> {
  const rows = await db
    .select()
    .from(alerterState)
    .where(eq(alerterState.kind, kind))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  const sentAt = row.lastSummarySentAt;
  if (!sentAt) return null;
  const elapsed = Date.now() - sentAt.getTime();
  if (elapsed > withinMs) return null;
  return { lastSentAt: sentAt, summary: row.lastSummary };
}
