import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  applePayJobs,
  applePayJobItems,
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
 * Reset any `running` jobs to `pending` so the worker can pick them up.
 * Called once at server startup — the assumption (matching the rest of this
 * codebase, e.g. PaymentScheduler) is a single backend instance, so any row
 * still in `running` after a fresh boot was interrupted by a crash/restart
 * and is safe to revive.
 */
export async function recoverInterruptedApplePayJobs(): Promise<number> {
  const updated = await db
    .update(applePayJobs)
    .set({ status: "pending" })
    .where(eq(applePayJobs.status, "running"))
    .returning({ id: applePayJobs.id });
  return updated.length;
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
 * Atomically transition an item from `pending` to a terminal state. Returns
 * `true` if this caller won the claim (and the update was applied), `false` if
 * another worker already finished it. Prevents double provider calls when two
 * workers see the same pending item.
 */
export async function claimAndCompleteApplePayJobItem(
  itemId: number,
  patch: { status: Exclude<ApplePayJobItemStatus, "pending">; message?: string | null },
): Promise<boolean> {
  const updated = await db
    .update(applePayJobItems)
    .set({
      status: patch.status,
      message: patch.message ?? null,
      processedAt: new Date().toISOString(),
    })
    .where(and(eq(applePayJobItems.id, itemId), eq(applePayJobItems.status, "pending")))
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
    else if (it.status === "pending") result.pending++;
  }
  return result;
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
