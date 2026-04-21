import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  applePayJobs,
  applePayJobItems,
  APPLE_PAY_ITEM_LEASE_MS,
  type ApplePayJob,
  type ApplePayJobItem,
  type ApplePayJobStatus,
  type ApplePayJobItemStatus,
} from "@shared/schema";

export async function createApplePayJob(createdBy: number | null): Promise<ApplePayJob> {
  const [row] = await db
    .insert(applePayJobs)
    .values({ status: "pending", createdBy: createdBy ?? null })
    .returning();
  return row;
}

export async function getApplePayJob(id: number): Promise<ApplePayJob | undefined> {
  const [row] = await db.select().from(applePayJobs).where(eq(applePayJobs.id, id));
  return row;
}

export async function listApplePayJobs(limit = 25): Promise<ApplePayJob[]> {
  return db
    .select()
    .from(applePayJobs)
    .orderBy(desc(applePayJobs.createdAt))
    .limit(limit);
}

/**
 * Atomically claim the next `pending` job to work on. Returns the claimed job
 * (with `status` set to `running`) or `undefined` if there is nothing to do.
 *
 * Only `pending` jobs are eligible — running jobs are assumed owned by another
 * worker. Stale `running` rows from a crashed worker are revived by
 * `recoverInterruptedApplePayJobs()` at server startup.
 *
 * Row is locked `FOR UPDATE SKIP LOCKED` so two workers cannot claim the same
 * job concurrently.
 */
export async function claimNextApplePayJob(): Promise<ApplePayJob | undefined> {
  return db.transaction(async (tx) => {
    const candidates = await tx.execute(sql`
      SELECT id FROM apple_pay_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    const row = (candidates.rows ?? candidates)[0] as { id: number } | undefined;
    if (!row) return undefined;

    const [updated] = await tx
      .update(applePayJobs)
      .set({
        status: "running",
        startedAt: sql`COALESCE(${applePayJobs.startedAt}, NOW())`,
      })
      .where(eq(applePayJobs.id, row.id))
      .returning();
    return updated;
  });
}

/**
 * Server-startup recovery of mid-flight Apple Pay work.
 *
 * Two passes:
 *   1. Re-open `running` jobs (the worker re-claims via `claimNextApplePayJob`).
 *   2. Revive `processing` items whose pre-call lease has expired (i.e.
 *      `claimed_at` is older than `APPLE_PAY_ITEM_LEASE_MS`, or NULL —
 *      the latter is a defensive fallback for rows written before the
 *      lease column was added). Items whose lease is still valid belong
 *      to a sibling instance that is actively mid-call and MUST NOT be
 *      reverted, because doing so would let a third worker re-issue the
 *      provider call before the original returns.
 *
 * This makes the at-most-once provider-call guarantee hold across both
 * single-instance crashes (lease expires before we boot, item is revived)
 * and overlapping rolling restarts (sibling's lease is still fresh, item
 * stays `processing` until the sibling writes its terminal result).
 *
 * Returns both the revived job ids and the per-item revivals so callers
 * can log/alert on items that stalled long enough to expire their lease
 * (an anomaly worth surfacing — see #270).
 */
export interface ApplePayRecoveryResult {
  /** Jobs flipped from `running` back to `pending`. */
  revivedJobIds: number[];
  /** Items whose pre-call lease expired (or was NULL backfill). */
  revivedItems: Array<{ jobId: number; itemId: number }>;
}

export async function recoverInterruptedApplePayJobs(): Promise<ApplePayRecoveryResult> {
  const updatedJobs = await db
    .update(applePayJobs)
    .set({ status: "pending" })
    .where(eq(applePayJobs.status, "running"))
    .returning({ id: applePayJobs.id });

  // Lease cutoff is computed entirely in DB time (NOW() - interval) to
  // avoid clock skew between app servers and Postgres. Any `processing`
  // row whose `claimed_at` is older than the lease is presumed orphaned
  // by a crashed worker. We bump `recovered_count` so the admin UI can
  // flag jobs that had any items stall mid-call.
  const leaseSeconds = Math.ceil(APPLE_PAY_ITEM_LEASE_MS / 1000);
  const updatedItems = await db
    .update(applePayJobItems)
    .set({
      status: "pending",
      claimedAt: null,
      recoveredCount: sql`${applePayJobItems.recoveredCount} + 1`,
    })
    .where(
      and(
        eq(applePayJobItems.status, "processing"),
        // `claimed_at IS NULL` covers rows written before the lease
        // column existed; `claimed_at < NOW() - lease` is the normal case.
        sql`(${applePayJobItems.claimedAt} IS NULL OR ${applePayJobItems.claimedAt} < NOW() - (${leaseSeconds} || ' seconds')::interval)`,
      ),
    )
    .returning({ id: applePayJobItems.id, jobId: applePayJobItems.jobId });

  return {
    revivedJobIds: updatedJobs.map((j) => j.id),
    revivedItems: updatedItems.map((i) => ({ jobId: i.jobId, itemId: i.id })),
  };
}

export async function insertApplePayJobItems(
  jobId: number,
  items: Array<{
    organizationId: number | null;
    locationId: number | null;
    domain: string;
    status?: ApplePayJobItemStatus;
    message?: string | null;
  }>,
): Promise<void> {
  if (items.length === 0) return;
  const now = new Date().toISOString();
  // ON CONFLICT DO NOTHING makes enumeration idempotent — if a previous run
  // (or a re-claim) already inserted items for this (job, org, location,
  // domain), we silently skip duplicates.
  await db
    .insert(applePayJobItems)
    .values(
      items.map((it) => ({
        jobId,
        organizationId: it.organizationId,
        locationId: it.locationId,
        domain: it.domain,
        status: it.status ?? "pending",
        message: it.message ?? null,
        processedAt: it.status && it.status !== "pending" ? now : null,
      })),
    )
    .onConflictDoNothing();
}

export async function countApplePayJobItems(jobId: number): Promise<number> {
  const rows = await db
    .select({ id: applePayJobItems.id })
    .from(applePayJobItems)
    .where(eq(applePayJobItems.jobId, jobId));
  return rows.length;
}

export async function setApplePayJobTotal(jobId: number, total: number): Promise<void> {
  await db.update(applePayJobs).set({ totalDomains: total }).where(eq(applePayJobs.id, jobId));
}

export async function getPendingApplePayJobItems(jobId: number): Promise<ApplePayJobItem[]> {
  return db
    .select()
    .from(applePayJobItems)
    .where(and(eq(applePayJobItems.jobId, jobId), eq(applePayJobItems.status, "pending")))
    .orderBy(asc(applePayJobItems.id));
}

export async function getApplePayJobItems(jobId: number): Promise<ApplePayJobItem[]> {
  return db
    .select()
    .from(applePayJobItems)
    .where(eq(applePayJobItems.jobId, jobId))
    .orderBy(asc(applePayJobItems.id));
}

export async function updateApplePayJobItem(
  itemId: number,
  patch: { status: ApplePayJobItemStatus; message?: string | null },
): Promise<void> {
  await db
    .update(applePayJobItems)
    .set({
      status: patch.status,
      message: patch.message ?? null,
      processedAt: new Date().toISOString(),
    })
    .where(eq(applePayJobItems.id, itemId));
}

/**
 * Atomically claim an item for the worker about to issue a provider call.
 * Flips `pending` -> `processing` and stamps `claimed_at = NOW()`. Returns
 * `true` only if THIS caller won the claim. A second worker racing on the
 * same item will get `false` and must NOT issue the provider call.
 *
 * The `claimed_at` timestamp acts as a lease: if the process crashes
 * between this claim and the terminal write, `recoverInterruptedApplePayJobs`
 * will only revert the row once the lease (`APPLE_PAY_ITEM_LEASE_MS`) has
 * expired. A live sibling instance whose lease is still valid is therefore
 * never disturbed by another instance's startup recovery.
 */
export async function claimApplePayJobItemForProcessing(itemId: number): Promise<boolean> {
  const updated = await db
    .update(applePayJobItems)
    .set({ status: "processing", claimedAt: sql`NOW()` })
    .where(and(eq(applePayJobItems.id, itemId), eq(applePayJobItems.status, "pending")))
    .returning({ id: applePayJobItems.id });
  return updated.length > 0;
}

/**
 * Atomically transition an item from `pending` or `processing` to a
 * terminal state. Returns `true` if the update was applied. Accepts
 * `processing` so the worker can complete an item it pre-claimed via
 * `claimApplePayJobItemForProcessing`, and `pending` so terminal-only
 * paths (e.g. "skipped, no location") that bypass the pre-claim still
 * work without a redundant round-trip.
 */
export async function claimAndCompleteApplePayJobItem(
  itemId: number,
  patch: { status: Exclude<ApplePayJobItemStatus, "pending" | "processing">; message?: string | null },
): Promise<boolean> {
  const updated = await db
    .update(applePayJobItems)
    .set({
      status: patch.status,
      message: patch.message ?? null,
      processedAt: new Date().toISOString(),
      // Clear the lease — terminal rows are no longer "in flight" and
      // must not look like a stuck claim to startup recovery.
      claimedAt: null,
    })
    .where(
      and(
        eq(applePayJobItems.id, itemId),
        sql`${applePayJobItems.status} IN ('pending', 'processing')`,
      ),
    )
    .returning({ id: applePayJobItems.id });
  return updated.length > 0;
}

export async function getApplePayJobItemCounts(jobId: number): Promise<{
  succeeded: number;
  failed: number;
  skipped: number;
  pending: number;
}> {
  const items = await db
    .select({ status: applePayJobItems.status })
    .from(applePayJobItems)
    .where(eq(applePayJobItems.jobId, jobId));
  const result = { succeeded: 0, failed: 0, skipped: 0, pending: 0 };
  for (const it of items) {
    if (it.status === "succeeded") result.succeeded++;
    else if (it.status === "failed") result.failed++;
    else if (it.status === "skipped") result.skipped++;
    // `processing` is not yet a terminal state — show it as pending in
    // the UI so progress stays accurate while the worker is mid-call.
    else if (it.status === "pending" || it.status === "processing") result.pending++;
  }
  return result;
}

/**
 * Lightweight status read used by the worker to detect mid-job cancellation.
 */
export async function getApplePayJobStatus(jobId: number): Promise<ApplePayJobStatus | undefined> {
  const [row] = await db
    .select({ status: applePayJobs.status })
    .from(applePayJobs)
    .where(eq(applePayJobs.id, jobId));
  return row?.status as ApplePayJobStatus | undefined;
}

/**
 * Cancel a job. Behavior depends on current status:
 *  - `pending`: flips to `canceled` immediately and stamps completedAt.
 *  - `running`: flips to `canceled`; the worker checks status between items
 *    and stops issuing new provider calls. Already-claimed items finish.
 * Returns the updated job, or `undefined` if it was not in a cancelable state.
 */
export async function cancelApplePayJob(jobId: number): Promise<ApplePayJob | undefined> {
  const [updated] = await db
    .update(applePayJobs)
    .set({
      status: "canceled",
      completedAt: sql`COALESCE(${applePayJobs.completedAt}, NOW())`,
    })
    .where(and(
      eq(applePayJobs.id, jobId),
      sql`${applePayJobs.status} IN ('pending', 'running')`,
    ))
    .returning();
  return updated;
}

/**
 * Reset failed items in a terminal job back to `pending` and re-open the job
 * so the worker will pick it up again. Idempotent — only acts on jobs in a
 * terminal state. Returns the re-opened job, or `undefined` if not retryable
 * (e.g. already pending/running, or no failed items).
 */
export async function retryApplePayJob(jobId: number): Promise<{ job: ApplePayJob; resetCount: number } | undefined> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(applePayJobs).where(eq(applePayJobs.id, jobId));
    if (!job) return undefined;
    if (job.status !== "failed" && job.status !== "partial" && job.status !== "canceled") {
      return undefined;
    }

    const reset = await tx
      .update(applePayJobItems)
      .set({ status: "pending", message: null, processedAt: null })
      .where(and(eq(applePayJobItems.jobId, jobId), eq(applePayJobItems.status, "failed")))
      .returning({ id: applePayJobItems.id });

    if (reset.length === 0) return undefined;

    const [updated] = await tx
      .update(applePayJobs)
      .set({
        status: "pending",
        completedAt: null,
        errorMessage: null,
      })
      .where(eq(applePayJobs.id, jobId))
      .returning();
    return { job: updated, resetCount: reset.length };
  });
}

/**
 * Reset a single failed item back to `pending` and re-open its parent job
 * so the worker will retry just that item. The retry is only permitted when
 * the parent job is itself in a terminal state — retrying an item while the
 * job is still `running` would strand the reset row outside the worker's
 * already-loaded pending queue, leading to incorrect final accounting.
 *
 * Scoping is enforced atomically: the item must belong to `jobId`. If the
 * caller passes a mismatched `(jobId, itemId)` pair, no rows are mutated.
 *
 * Returns the updated item + job, or `undefined` if the item/job is not in
 * a retryable state.
 */
export async function retryApplePayJobItem(
  jobId: number,
  itemId: number,
): Promise<{ item: ApplePayJobItem; job: ApplePayJob } | undefined> {
  return db.transaction(async (tx) => {
    // Validate parent-job state BEFORE touching the item, so a mismatched
    // (jobId, itemId) or a non-terminal job leaves all rows unchanged.
    const [job] = await tx.select().from(applePayJobs).where(eq(applePayJobs.id, jobId));
    if (!job) return undefined;
    if (job.status !== "failed" && job.status !== "partial" && job.status !== "canceled") {
      return undefined;
    }

    const [updatedItem] = await tx
      .update(applePayJobItems)
      .set({ status: "pending", message: null, processedAt: null })
      .where(and(
        eq(applePayJobItems.id, itemId),
        eq(applePayJobItems.jobId, jobId),
        eq(applePayJobItems.status, "failed"),
      ))
      .returning();
    if (!updatedItem) return undefined;

    const [reopened] = await tx
      .update(applePayJobs)
      .set({ status: "pending", completedAt: null, errorMessage: null })
      .where(eq(applePayJobs.id, jobId))
      .returning();

    return { item: updatedItem, job: reopened };
  });
}

export async function finalizeApplePayJob(
  jobId: number,
  patch: {
    status: ApplePayJobStatus;
    succeededCount: number;
    failedCount: number;
    skippedCount: number;
    errorMessage?: string | null;
  },
): Promise<void> {
  await db
    .update(applePayJobs)
    .set({
      status: patch.status,
      succeededCount: patch.succeededCount,
      failedCount: patch.failedCount,
      skippedCount: patch.skippedCount,
      errorMessage: patch.errorMessage ?? null,
      completedAt: new Date().toISOString(),
    })
    .where(eq(applePayJobs.id, jobId));
}
