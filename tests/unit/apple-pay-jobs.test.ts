/**
 * Concurrency / idempotency tests for the Apple Pay background job storage.
 *
 * These tests hit the real test database and exercise the SQL-level
 * invariants the worker relies on:
 *   1. `claimNextApplePayJob` (FOR UPDATE SKIP LOCKED + status='pending')
 *      gives the same job to exactly one of N concurrent workers.
 *   2. `claimAndCompleteApplePayJobItem` (UPDATE … WHERE status='pending')
 *      is atomic — only the first caller succeeds for a given item.
 *   3. `insertApplePayJobItems` is idempotent thanks to the unique index on
 *      (job_id, COALESCE(org,0), COALESCE(loc,0), domain) + ON CONFLICT
 *      DO NOTHING.
 *   4. After a simulated crash mid-run, `recoverInterruptedApplePayJobs`
 *      revives `running` jobs and the worker only re-processes items that
 *      were still `pending`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { inArray, eq } from "drizzle-orm";
import { db } from "../../server/db";
import { applePayJobs, applePayJobItems, APPLE_PAY_ITEM_LEASE_MS, type ApplePayJobStatus } from "@shared/schema";
import {
  createApplePayJob,
  claimNextApplePayJob,
  recoverInterruptedApplePayJobs,
  insertApplePayJobItems,
  countApplePayJobItems,
  getPendingApplePayJobItems,
  getApplePayJobItems,
  claimAndCompleteApplePayJobItem,
  claimApplePayJobItemForProcessing,
  updateApplePayJobItem,
  getApplePayJob,
  getApplePayJobItemCounts,
  cancelApplePayJob,
  deleteApplePayJob,
  retryApplePayJob,
  retryApplePayJobItem,
  reopenApplePayJobForRetry,
  finalizeApplePayJob,
} from "../../server/storage/apple-pay-jobs";

const createdJobIds: number[] = [];

async function makeJob(): Promise<number> {
  const job = await createApplePayJob(null);
  createdJobIds.push(job.id);
  return job.id;
}

/**
 * Find an element in `arr` matching `pred`, failing the test loudly if
 * the expected row is missing. Used in place of `arr.find(pred)!` so a
 * missing row surfaces as a clear assertion message instead of an
 * opaque `Cannot read properties of undefined` later in the test.
 */
function mustFind<T>(arr: readonly T[], pred: (item: T) => boolean, label: string): T {
  const found = arr.find(pred);
  if (found === undefined) {
    throw new Error(`expected to find ${label}`);
  }
  return found;
}

afterEach(async () => {
  if (createdJobIds.length === 0) return;
  // Items are removed via the FK ON DELETE CASCADE.
  await db.delete(applePayJobs).where(inArray(applePayJobs.id, createdJobIds));
  createdJobIds.length = 0;
});

describe("apple pay job storage — concurrency invariants", () => {
  it("claimNextApplePayJob gives the same pending job to exactly one of two concurrent workers", async () => {
    const jobId = await makeJob();
    // Scope every claim to this test's own job id. The shared test DB
    // means another test file may have inserted a `pending` row in
    // between, which would otherwise be picked by the second/third
    // claim and confuse the SKIP-LOCKED assertions below.
    const scope = { onlyJobIds: [jobId] };

    const [a, b] = await Promise.all([
      claimNextApplePayJob(scope),
      claimNextApplePayJob(scope),
    ]);

    const winners = [a, b].filter((j) => j?.id === jobId);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.status).toBe("running");

    // The losing call must have returned undefined — the only `pending`
    // row in scope is the one the winner just flipped to `running`.
    const loser = [a, b].find((j) => j?.id !== jobId);
    expect(loser).toBeUndefined();

    // A subsequent claim should not re-pick the now-running job.
    const followUp = await claimNextApplePayJob(scope);
    expect(followUp).toBeUndefined();
  });

  it("claimNextApplePayJob ignores rows already in 'running'", async () => {
    const jobId = await makeJob();
    const scope = { onlyJobIds: [jobId] };
    const first = await claimNextApplePayJob(scope);
    expect(first?.id).toBe(jobId);

    // No other pending job exists in scope, so the second claim must be
    // undefined — the running row must NOT be re-claimed.
    const second = await claimNextApplePayJob(scope);
    expect(second).toBeUndefined();
  });

  it("claimAndCompleteApplePayJobItem only succeeds for the first caller", async () => {
    const jobId = await makeJob();
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "example.test" },
    ]);
    const [item] = await getPendingApplePayJobItems(jobId);
    expect(item).toBeDefined();

    const [winA, winB] = await Promise.all([
      claimAndCompleteApplePayJobItem(item.id, { status: "succeeded", message: "from A" }),
      claimAndCompleteApplePayJobItem(item.id, { status: "failed", message: "from B" }),
    ]);

    // Exactly one caller wins.
    expect([winA, winB].filter(Boolean)).toHaveLength(1);

    const [stored] = await getApplePayJobItems(jobId);
    // Whichever caller won, the row must reflect THAT message and status,
    // never an interleaving of the two.
    if (winA) {
      expect(stored.status).toBe("succeeded");
      expect(stored.message).toBe("from A");
    } else {
      expect(stored.status).toBe("failed");
      expect(stored.message).toBe("from B");
    }

    // A third call after the row is terminal must also fail.
    const third = await claimAndCompleteApplePayJobItem(item.id, {
      status: "succeeded",
      message: "too late",
    });
    expect(third).toBe(false);
  });

  it("insertApplePayJobItems is idempotent for the same enumeration", async () => {
    const jobId = await makeJob();
    const enumeration = [
      { organizationId: null, locationId: null, domain: "a.test" },
      { organizationId: null, locationId: null, domain: "b.test" },
      { organizationId: null, locationId: null, domain: "c.test" },
    ];

    await insertApplePayJobItems(jobId, enumeration);
    expect(await countApplePayJobItems(jobId)).toBe(3);

    // Re-running the same enumeration must NOT create duplicates.
    await insertApplePayJobItems(jobId, enumeration);
    expect(await countApplePayJobItems(jobId)).toBe(3);

    // Even when the duplicate insert and a brand-new row are mixed.
    await insertApplePayJobItems(jobId, [
      ...enumeration,
      { organizationId: null, locationId: null, domain: "d.test" },
    ]);
    expect(await countApplePayJobItems(jobId)).toBe(4);
  });

  it("insertApplePayJobItems is idempotent under concurrent inserts of overlapping batches", async () => {
    const jobId = await makeJob();
    const overlap = [
      { organizationId: null, locationId: null, domain: "x.test" },
      { organizationId: null, locationId: null, domain: "y.test" },
      { organizationId: null, locationId: null, domain: "z.test" },
    ];
    const extraA = { organizationId: null, locationId: null, domain: "only-a.test" };
    const extraB = { organizationId: null, locationId: null, domain: "only-b.test" };

    // Two enumerators race on the same job. The unique index + ON CONFLICT
    // DO NOTHING must keep the final cardinality at exactly the union size.
    await Promise.all([
      insertApplePayJobItems(jobId, [...overlap, extraA]),
      insertApplePayJobItems(jobId, [...overlap, extraB]),
    ]);

    expect(await countApplePayJobItems(jobId)).toBe(5);
    const domains = (await getApplePayJobItems(jobId)).map((it) => it.domain).sort();
    expect(domains).toEqual([
      "only-a.test",
      "only-b.test",
      "x.test",
      "y.test",
      "z.test",
    ]);
  });

  it("recoverInterruptedApplePayJobs revives 'running' jobs and resume only re-processes pending items", async () => {
    const jobId = await makeJob();
    const scope = { onlyJobIds: [jobId] };

    // Simulate an interrupted run: enumerate items, claim the job
    // (status -> running), finish a few items, then "crash" leaving the
    // rest pending and the job stuck in running.
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "done-1.test" },
      { organizationId: null, locationId: null, domain: "done-2.test" },
      { organizationId: null, locationId: null, domain: "todo-1.test" },
      { organizationId: null, locationId: null, domain: "todo-2.test" },
    ]);
    const claimed = await claimNextApplePayJob(scope);
    expect(claimed?.id).toBe(jobId);
    expect(claimed?.status).toBe("running");

    const items = await getApplePayJobItems(jobId);
    await updateApplePayJobItem(items[0].id, { status: "succeeded" });
    await updateApplePayJobItem(items[1].id, { status: "failed", message: "boom" });

    // -- crash boundary: job row is still 'running', items 2 & 3 still pending.

    // After-restart bookkeeping.
    const revived = await recoverInterruptedApplePayJobs(scope);
    expect(revived.revivedJobIds).toContain(jobId);
    const reloaded = await getApplePayJob(jobId);
    expect(reloaded?.status).toBe("pending");

    // Re-running enumeration on resume must NOT duplicate the existing rows
    // and must NOT reset already-finished items back to pending.
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "done-1.test" },
      { organizationId: null, locationId: null, domain: "done-2.test" },
      { organizationId: null, locationId: null, domain: "todo-1.test" },
      { organizationId: null, locationId: null, domain: "todo-2.test" },
    ]);
    expect(await countApplePayJobItems(jobId)).toBe(4);

    // Worker resumes — must be able to re-claim the job…
    const reclaimed = await claimNextApplePayJob(scope);
    expect(reclaimed?.id).toBe(jobId);

    // …and only the previously-pending items show up for processing.
    const stillPending = await getPendingApplePayJobItems(jobId);
    expect(stillPending.map((it) => it.domain).sort()).toEqual([
      "todo-1.test",
      "todo-2.test",
    ]);
  });

  it("claimApplePayJobItemForProcessing only lets one of N concurrent workers issue the provider call", async () => {
    const jobId = await makeJob();
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "race.test" },
    ]);
    const [item] = await getPendingApplePayJobItems(jobId);
    expect(item).toBeDefined();

    // Three workers race on the pre-call claim.
    const claims = await Promise.all([
      claimApplePayJobItemForProcessing(item.id),
      claimApplePayJobItemForProcessing(item.id),
      claimApplePayJobItemForProcessing(item.id),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);

    // The item is now `processing`. `getPendingApplePayJobItems` must NOT
    // surface it again — a fresh worker iteration must skip it.
    const pendingNow = await getPendingApplePayJobItems(jobId);
    expect(pendingNow).toHaveLength(0);

    // Counts must roll `processing` into the pending bucket so the UI's
    // progress bar doesn't prematurely show the item as completed.
    const counts = await getApplePayJobItemCounts(jobId);
    expect(counts).toEqual({ succeeded: 0, failed: 0, skipped: 0, pending: 1 });

    // The winning worker now writes the terminal state. Terminal write must
    // accept `processing` as a valid source state.
    const terminal = await claimAndCompleteApplePayJobItem(item.id, {
      status: "succeeded",
      message: "ok",
    });
    expect(terminal).toBe(true);

    const [stored] = await getApplePayJobItems(jobId);
    expect(stored.status).toBe("succeeded");
    expect(stored.message).toBe("ok");
  });

  it("recoverInterruptedApplePayJobs revives items whose pre-call lease has EXPIRED, leaves fresh leases alone", async () => {
    const jobId = await makeJob();
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "expired-1.test" },
      { organizationId: null, locationId: null, domain: "expired-2.test" },
      { organizationId: null, locationId: null, domain: "done.test" },
    ]);
    const items = await getApplePayJobItems(jobId);
    const expired1 = items.find((it) => it.domain === "expired-1.test")!;
    const expired2 = items.find((it) => it.domain === "expired-2.test")!;
    const done = items.find((it) => it.domain === "done.test")!;

    // Two items get pre-claimed but the worker crashed before writing
    // their terminal state, AND enough wall time has passed that the
    // lease is now expired. A third already finished cleanly.
    expect(await claimApplePayJobItemForProcessing(expired1.id)).toBe(true);
    expect(await claimApplePayJobItemForProcessing(expired2.id)).toBe(true);
    await claimAndCompleteApplePayJobItem(done.id, { status: "succeeded" });

    // Backdate the leases to simulate a crashed worker whose lease
    // expired before the next instance booted (simulating wall time
    // without sleeping the test).
    const expiredAt = new Date(Date.now() - APPLE_PAY_ITEM_LEASE_MS - 60_000).toISOString();
    await db
      .update(applePayJobItems)
      .set({ claimedAt: expiredAt })
      .where(inArray(applePayJobItems.id, [expired1.id, expired2.id]));

    const result = await recoverInterruptedApplePayJobs({ onlyJobIds: [jobId] });

    // #270: result must surface what was revived so the worker can log it
    // and the admin UI can flag the affected job as anomalous.
    expect(result.revivedItems.map((i) => i.itemId).sort()).toEqual(
      [expired1.id, expired2.id].sort(),
    );
    expect(result.revivedItems.every((i) => i.jobId === jobId)).toBe(true);

    const reloaded = await getApplePayJobItems(jobId);
    const byDomain = Object.fromEntries(reloaded.map((it) => [it.domain, it.status]));
    expect(byDomain["expired-1.test"]).toBe("pending");
    expect(byDomain["expired-2.test"]).toBe("pending");

    // #270: recovered_count must be incremented on each revived item so
    // the per-job aggregate stays accurate across multiple recovery sweeps.
    const revivedRows = reloaded.filter((it) =>
      [expired1.id, expired2.id].includes(it.id),
    );
    expect(revivedRows.every((it) => it.recoveredCount === 1)).toBe(true);
    const doneRow = reloaded.find((it) => it.id === done.id)!;
    expect(doneRow.recoveredCount).toBe(0);
    // Already-terminal items must not be touched by the recovery sweep.
    expect(byDomain["done.test"]).toBe("succeeded");

    // Recovery must also clear the lease so subsequent recoveries don't
    // immediately treat a fresh re-claim as already expired.
    const reloaded1 = reloaded.find((it) => it.id === expired1.id)!;
    expect(reloaded1.claimedAt).toBeNull();

    // The next worker pass must see exactly the two revived items as pending.
    const pending = await getPendingApplePayJobItems(jobId);
    expect(pending.map((it) => it.domain).sort()).toEqual([
      "expired-1.test",
      "expired-2.test",
    ]);
  });

  it("recoverInterruptedApplePayJobs leaves a sibling instance's LIVE pre-claim alone (rolling restart safety)", async () => {
    // Simulates: instance A is mid-call on an item (lease is fresh).
    // Instance B boots and runs startup recovery. The item must NOT
    // be reverted to pending — that would let a third worker re-issue
    // the provider call before A's call returns.
    const jobId = await makeJob();
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "live.test" },
      { organizationId: null, locationId: null, domain: "expired.test" },
    ]);
    const items = await getApplePayJobItems(jobId);
    const live = items.find((it) => it.domain === "live.test")!;
    const expired = items.find((it) => it.domain === "expired.test")!;

    // Both items get pre-claimed.
    expect(await claimApplePayJobItemForProcessing(live.id)).toBe(true);
    expect(await claimApplePayJobItemForProcessing(expired.id)).toBe(true);

    // Backdate ONLY one item's lease to simulate the asymmetric
    // rolling-restart scenario: one sibling crashed long ago, another
    // is currently mid-call.
    const expiredAt = new Date(Date.now() - APPLE_PAY_ITEM_LEASE_MS - 60_000).toISOString();
    await db
      .update(applePayJobItems)
      .set({ claimedAt: expiredAt })
      .where(eq(applePayJobItems.id, expired.id));

    await recoverInterruptedApplePayJobs({ onlyJobIds: [jobId] });

    const reloaded = await getApplePayJobItems(jobId);
    const liveAfter = reloaded.find((it) => it.id === live.id)!;
    const expiredAfter = reloaded.find((it) => it.id === expired.id)!;

    // The live sibling's claim is preserved end-to-end: status stays
    // `processing`, the lease timestamp is untouched, and the row does
    // NOT show up in the pending queue another worker would scan.
    expect(liveAfter.status).toBe("processing");
    expect(liveAfter.claimedAt).not.toBeNull();
    // Crashed sibling's row is reset, lease cleared.
    expect(expiredAfter.status).toBe("pending");
    expect(expiredAfter.claimedAt).toBeNull();

    const pending = await getPendingApplePayJobItems(jobId);
    expect(pending.map((it) => it.domain)).toEqual(["expired.test"]);

    // And the live sibling can still successfully complete its terminal
    // write — terminal write must not be blocked by a parallel recovery
    // sweep that left the row alone.
    const completed = await claimAndCompleteApplePayJobItem(live.id, {
      status: "succeeded",
      message: "ok from live sibling",
    });
    expect(completed).toBe(true);
    const final = (await getApplePayJobItems(jobId)).find((it) => it.id === live.id)!;
    expect(final.status).toBe("succeeded");
    expect(final.claimedAt).toBeNull();
  });
});

/**
 * Cancel + retry storage invariants (task #264).
 *
 * Pins the per-status guards on `cancelApplePayJob`, `retryApplePayJob`,
 * and `retryApplePayJobItem`. These transactions only act on specific
 * source statuses; without these tests it would be easy to silently
 * regress them into "always succeeds" stubs.
 */
async function setJobStatus(jobId: number, status: ApplePayJobStatus): Promise<void> {
  await db
    .update(applePayJobs)
    .set({
      status,
      // Terminal rows in the real product carry a completedAt; mirror
      // that here so the guard tests start from a realistic shape.
      completedAt: status === "pending" || status === "running" ? null : new Date().toISOString(),
    })
    .where(eq(applePayJobs.id, jobId));
}

describe("apple pay job storage — reopenApplePayJobForRetry (#568)", () => {
  it("flips a running job back to pending and clears completedAt/errorMessage", async () => {
    // Worker uses this when it cannot finalize because items are still
    // non-terminal after a bounded re-drain — the job must go back into
    // the pending queue so the next worker tick re-claims it.
    const jobId = await makeJob();
    await db
      .update(applePayJobs)
      .set({
        status: "running",
        startedAt: new Date().toISOString(),
        // Set both to prove the reopen clears them — the next run starts
        // from a clean slate.
        completedAt: new Date().toISOString(),
        errorMessage: "stale error from a prior pass",
      })
      .where(eq(applePayJobs.id, jobId));

    const result = await reopenApplePayJobForRetry(jobId);
    expect(result).toBe(true);

    const reloaded = await getApplePayJob(jobId);
    expect(reloaded?.status).toBe("pending");
    expect(reloaded?.completedAt).toBeNull();
    expect(reloaded?.errorMessage).toBeNull();
  });

  it("is a no-op for jobs not currently in `running` status", async () => {
    // Idempotent guard: if the job has already been canceled or
    // finalized via another path, reopen must NOT clobber that state.
    for (const status of ["pending", "succeeded", "failed", "partial", "canceled"] as const) {
      const jobId = await makeJob();
      await db
        .update(applePayJobs)
        .set({
          status,
          completedAt: status === "pending" ? null : new Date().toISOString(),
        })
        .where(eq(applePayJobs.id, jobId));

      const result = await reopenApplePayJobForRetry(jobId);
      expect(result, `reopen of ${status} job should be a no-op`).toBe(false);

      const reloaded = await getApplePayJob(jobId);
      expect(reloaded?.status).toBe(status);
    }
  });

  it("after reopen, the job can be re-claimed by the worker (resumes from items table)", async () => {
    // End-to-end shape of the resume sequence: enumerate items, claim
    // the job (running), simulate the bounded-drain bail-out by reopen,
    // then re-claim — the new claim must see the same items table and
    // pick up where we left off.
    const jobId = await makeJob();
    const scope = { onlyJobIds: [jobId] };
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "resume-1.test" },
      { organizationId: null, locationId: null, domain: "resume-2.test" },
    ]);
    const claimed = await claimNextApplePayJob(scope);
    expect(claimed?.id).toBe(jobId);
    expect(claimed?.status).toBe("running");

    // Worker bails out without finalizing.
    expect(await reopenApplePayJobForRetry(jobId)).toBe(true);

    // Next worker tick can re-claim the job, and the items table is
    // intact (still 2 pending) so processing resumes cleanly.
    const reclaimed = await claimNextApplePayJob(scope);
    expect(reclaimed?.id).toBe(jobId);
    const stillPending = await getPendingApplePayJobItems(jobId);
    expect(stillPending.map((i) => i.domain).sort()).toEqual(["resume-1.test", "resume-2.test"]);
  });

  it("after the bounded recovery sequence, finalize counts match the items table exactly", async () => {
    // Reproduces the job #523 invariant: a crash leaves one item
    // `processing` past its lease; recovery revives it; the resume run
    // processes it; the job's final counts equal the items table.
    const jobId = await makeJob();
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "crash-done.test" },
      { organizationId: null, locationId: null, domain: "crash-stranded.test" },
    ]);
    const items = await getApplePayJobItems(jobId);
    const done = mustFind(items, (i) => i.domain === "crash-done.test", "crash-done.test item");
    const stranded = mustFind(items, (i) => i.domain === "crash-stranded.test", "crash-stranded.test item");

    // Pretend the worker claimed both items mid-call before crashing.
    expect(await claimApplePayJobItemForProcessing(done.id)).toBe(true);
    expect(await claimApplePayJobItemForProcessing(stranded.id)).toBe(true);
    // The first item finished cleanly before the crash.
    await claimAndCompleteApplePayJobItem(done.id, { status: "succeeded", message: "ok" });
    // The second item never got its terminal write — and the job row
    // is still in `running` from the original claim.
    await db
      .update(applePayJobs)
      .set({ status: "running" })
      .where(eq(applePayJobs.id, jobId));
    const expiredAt = new Date(Date.now() - APPLE_PAY_ITEM_LEASE_MS - 60_000).toISOString();
    await db
      .update(applePayJobItems)
      .set({ claimedAt: expiredAt })
      .where(eq(applePayJobItems.id, stranded.id));

    // Server boot recovery sweep.
    await recoverInterruptedApplePayJobs({ onlyJobIds: [jobId] });
    const reloadedJob = await getApplePayJob(jobId);
    expect(reloadedJob?.status).toBe("pending");
    const strandedAfterRecovery = mustFind(
      await getApplePayJobItems(jobId),
      (i) => i.id === stranded.id,
      "stranded item after recovery",
    );
    expect(strandedAfterRecovery.status).toBe("pending");
    expect(strandedAfterRecovery.recoveredCount).toBe(1);

    // Worker re-claims the job and processes the revived item.
    const reclaimed = await claimNextApplePayJob({ onlyJobIds: [jobId] });
    expect(reclaimed?.id).toBe(jobId);
    const pendingAfterReclaim = await getPendingApplePayJobItems(jobId);
    expect(pendingAfterReclaim.map((i) => i.id)).toEqual([stranded.id]);
    await claimAndCompleteApplePayJobItem(stranded.id, {
      status: "skipped",
      message: "no location",
    });

    // Now finalize from the items-table source of truth — exactly
    // what the worker does after the bounded re-drain succeeds.
    const counts = await getApplePayJobItemCounts(jobId);
    // (a) Every item is terminal.
    expect(counts.pending).toBe(0);
    // (b) Counts reflect the items table exactly.
    expect(counts).toEqual({ succeeded: 1, failed: 0, skipped: 1, pending: 0 });

    let finalStatus: ApplePayJobStatus;
    if (counts.failed === 0 && counts.skipped === 0) finalStatus = "succeeded";
    else if (counts.succeeded === 0) finalStatus = "failed";
    else finalStatus = "partial";
    await finalizeApplePayJob(jobId, {
      status: finalStatus,
      succeededCount: counts.succeeded,
      failedCount: counts.failed,
      skippedCount: counts.skipped,
      errorMessage: null,
    });

    const finalRow = await getApplePayJob(jobId);
    expect(finalRow?.status).toBe("partial");
    expect(finalRow?.succeededCount).toBe(1);
    expect(finalRow?.failedCount).toBe(0);
    expect(finalRow?.skippedCount).toBe(1);
    expect(finalRow?.completedAt).not.toBeNull();
  });
});

describe("apple pay job storage — cancel guards", () => {
  it("cancels a pending job and stamps completedAt", async () => {
    const jobId = await makeJob();

    const updated = await cancelApplePayJob(jobId);

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("canceled");
    expect(updated!.completedAt).not.toBeNull();
  });

  it("cancels a running job (worker observes status flip mid-loop)", async () => {
    const jobId = await makeJob();
    // Directly mark the job as running rather than going through
    // claimNextApplePayJob — that helper may pick a different stale
    // pending row from previous test runs since this DB isn't reset
    // between test files. The cancel-storage behavior is what we're
    // exercising here, not the claim ordering.
    await db
      .update(applePayJobs)
      .set({ status: "running", startedAt: new Date().toISOString() })
      .where(eq(applePayJobs.id, jobId));

    const updated = await cancelApplePayJob(jobId);

    expect(updated).toBeDefined();
    expect(updated!.status).toBe("canceled");
    expect(updated!.completedAt).not.toBeNull();
  });

  it("preserves an existing completedAt when canceling (COALESCE)", async () => {
    const jobId = await makeJob();
    const stamped = new Date(Date.now() - 60_000).toISOString();
    await db
      .update(applePayJobs)
      .set({ completedAt: stamped })
      .where(eq(applePayJobs.id, jobId));

    const updated = await cancelApplePayJob(jobId);
    expect(updated).toBeDefined();
    // The pre-existing completedAt must NOT be overwritten by the cancel.
    expect(new Date(updated!.completedAt!).toISOString()).toBe(
      new Date(stamped).toISOString(),
    );
  });

  it("returns undefined for a job already in a terminal status", async () => {
    for (const terminal of ["succeeded", "failed", "partial", "canceled"] as const) {
      const jobId = await makeJob();
      await setJobStatus(jobId, terminal);

      const updated = await cancelApplePayJob(jobId);
      expect(updated, `expected cancel of ${terminal} job to be a no-op`).toBeUndefined();

      const reloaded = await getApplePayJob(jobId);
      expect(reloaded?.status).toBe(terminal);
    }
  });

  it("returns undefined for a non-existent job", async () => {
    const updated = await cancelApplePayJob(2_147_483_000);
    expect(updated).toBeUndefined();
  });
});

describe("apple pay job storage — delete guards", () => {
  it("deletes a terminal job and (via cascade) its items", async () => {
    for (const terminal of ["succeeded", "failed", "partial", "canceled"] as const) {
      const jobId = await makeJob();
      await insertApplePayJobItems(jobId, [
        { organizationId: null, locationId: null, domain: `del-${terminal}-1.test` },
        { organizationId: null, locationId: null, domain: `del-${terminal}-2.test` },
      ]);
      await db.update(applePayJobs).set({ status: terminal }).where(eq(applePayJobs.id, jobId));

      const deleted = await deleteApplePayJob(jobId);
      expect(deleted, `expected delete of ${terminal} job to succeed`).toBe(true);

      // Job row gone.
      const reloaded = await getApplePayJob(jobId);
      expect(reloaded).toBeUndefined();

      // Items gone via FK ON DELETE CASCADE.
      const orphanedItems = await db
        .select({ id: applePayJobItems.id })
        .from(applePayJobItems)
        .where(eq(applePayJobItems.jobId, jobId));
      expect(orphanedItems).toHaveLength(0);

      // Drop from cleanup list — the row is already gone.
      const idx = createdJobIds.indexOf(jobId);
      if (idx >= 0) createdJobIds.splice(idx, 1);
    }
  });

  it("refuses to delete an active job (pending or running)", async () => {
    for (const active of ["pending", "running"] as const) {
      const jobId = await makeJob();
      await db.update(applePayJobs).set({ status: active }).where(eq(applePayJobs.id, jobId));

      const deleted = await deleteApplePayJob(jobId);
      expect(deleted, `expected delete of ${active} job to be a no-op`).toBe(false);

      const reloaded = await getApplePayJob(jobId);
      expect(reloaded?.status).toBe(active);
    }
  });

  it("returns false for a non-existent job", async () => {
    const deleted = await deleteApplePayJob(2_147_483_000);
    expect(deleted).toBe(false);
  });
});

describe("apple pay job storage — retry job guards", () => {
  it("resets failed items and re-opens the job for failed/partial/canceled jobs", async () => {
    for (const terminal of ["failed", "partial", "canceled"] as const) {
      const jobId = await makeJob();
      await insertApplePayJobItems(jobId, [
        { organizationId: null, locationId: null, domain: `succeeded-${terminal}.test` },
        { organizationId: null, locationId: null, domain: `failed-1-${terminal}.test` },
        { organizationId: null, locationId: null, domain: `failed-2-${terminal}.test` },
      ]);
      const items = await getApplePayJobItems(jobId);
      const succeeded = items.find((i) => i.domain.startsWith("succeeded"))!;
      const failed1 = items.find((i) => i.domain.startsWith("failed-1"))!;
      const failed2 = items.find((i) => i.domain.startsWith("failed-2"))!;
      await claimAndCompleteApplePayJobItem(succeeded.id, { status: "succeeded" });
      await claimAndCompleteApplePayJobItem(failed1.id, { status: "failed", message: "boom" });
      await claimAndCompleteApplePayJobItem(failed2.id, { status: "failed", message: "kaboom" });
      await setJobStatus(jobId, terminal);
      // Set an errorMessage so we can assert it gets cleared on retry.
      await db
        .update(applePayJobs)
        .set({ errorMessage: "previous run error" })
        .where(eq(applePayJobs.id, jobId));

      const result = await retryApplePayJob(jobId);

      expect(result, `retry should succeed for ${terminal}`).toBeDefined();
      expect(result!.resetCount).toBe(2);
      expect(result!.job.status).toBe("pending");
      expect(result!.job.completedAt).toBeNull();
      expect(result!.job.errorMessage).toBeNull();

      // Failed items are reset; the succeeded item is untouched.
      const reloaded = await getApplePayJobItems(jobId);
      const byDomain = Object.fromEntries(reloaded.map((it) => [it.domain, it]));
      expect(byDomain[`succeeded-${terminal}.test`].status).toBe("succeeded");
      expect(byDomain[`failed-1-${terminal}.test`].status).toBe("pending");
      expect(byDomain[`failed-1-${terminal}.test`].message).toBeNull();
      expect(byDomain[`failed-1-${terminal}.test`].processedAt).toBeNull();
      expect(byDomain[`failed-2-${terminal}.test`].status).toBe("pending");
    }
  });

  it("returns undefined for a non-terminal job (pending or running)", async () => {
    for (const ineligible of ["pending", "running"] as const) {
      const jobId = await makeJob();
      await insertApplePayJobItems(jobId, [
        { organizationId: null, locationId: null, domain: `f-${ineligible}.test` },
      ]);
      const [item] = await getApplePayJobItems(jobId);
      await claimAndCompleteApplePayJobItem(item.id, { status: "failed", message: "no" });
      await setJobStatus(jobId, ineligible);

      const result = await retryApplePayJob(jobId);
      expect(result, `retry of ${ineligible} job should be a no-op`).toBeUndefined();

      // Critically, the item is NOT reset — would otherwise strand it
      // outside the running worker's already-loaded pending queue.
      const [reloaded] = await getApplePayJobItems(jobId);
      expect(reloaded.status).toBe("failed");
    }
  });

  it("returns undefined for a fully-succeeded terminal job", async () => {
    const jobId = await makeJob();
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "ok.test" },
    ]);
    const [item] = await getApplePayJobItems(jobId);
    await claimAndCompleteApplePayJobItem(item.id, { status: "succeeded" });
    await setJobStatus(jobId, "succeeded");

    const result = await retryApplePayJob(jobId);
    expect(result).toBeUndefined();
  });

  it("returns undefined for a terminal job with no failed items (e.g. all skipped)", async () => {
    const jobId = await makeJob();
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "skip.test" },
    ]);
    const [item] = await getApplePayJobItems(jobId);
    await claimAndCompleteApplePayJobItem(item.id, { status: "skipped", message: "no loc" });
    await setJobStatus(jobId, "partial");

    const result = await retryApplePayJob(jobId);
    expect(result).toBeUndefined();

    // Job stays terminal — must NOT have been re-opened.
    const reloaded = await getApplePayJob(jobId);
    expect(reloaded?.status).toBe("partial");
  });

  it("returns undefined for a non-existent job", async () => {
    const result = await retryApplePayJob(2_147_483_001);
    expect(result).toBeUndefined();
  });
});

describe("apple pay job storage — retry single-item guards", () => {
  it("resets a failed item and re-opens its terminal job", async () => {
    for (const terminal of ["failed", "partial", "canceled"] as const) {
      const jobId = await makeJob();
      await insertApplePayJobItems(jobId, [
        { organizationId: null, locationId: null, domain: `keep-${terminal}.test` },
        { organizationId: null, locationId: null, domain: `retry-${terminal}.test` },
      ]);
      const items = await getApplePayJobItems(jobId);
      const keep = items.find((i) => i.domain.startsWith("keep"))!;
      const retry = items.find((i) => i.domain.startsWith("retry"))!;
      await claimAndCompleteApplePayJobItem(keep.id, { status: "failed", message: "still bad" });
      await claimAndCompleteApplePayJobItem(retry.id, { status: "failed", message: "transient" });
      await setJobStatus(jobId, terminal);

      const result = await retryApplePayJobItem(jobId, retry.id);

      expect(result, `single-item retry should succeed for ${terminal}`).toBeDefined();
      expect(result!.item.status).toBe("pending");
      expect(result!.item.message).toBeNull();
      expect(result!.item.processedAt).toBeNull();
      expect(result!.job.status).toBe("pending");
      expect(result!.job.completedAt).toBeNull();

      // The other failed item is left alone — only the one we asked for resets.
      const reloaded = await getApplePayJobItems(jobId);
      const keepAfter = reloaded.find((i) => i.id === keep.id)!;
      expect(keepAfter.status).toBe("failed");
      expect(keepAfter.message).toBe("still bad");
    }
  });

  it("refuses to retry an item while its parent job is still running", async () => {
    // Resetting an item under a running job would strand it outside the
    // worker's already-loaded pending queue, breaking final accounting.
    const jobId = await makeJob();
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "running.test" },
    ]);
    const [item] = await getApplePayJobItems(jobId);
    await claimAndCompleteApplePayJobItem(item.id, { status: "failed", message: "x" });
    await setJobStatus(jobId, "running");

    const result = await retryApplePayJobItem(jobId, item.id);
    expect(result).toBeUndefined();
    const reloaded = (await getApplePayJobItems(jobId))[0];
    expect(reloaded.status).toBe("failed");
  });

  it("refuses to retry a non-failed item (e.g. succeeded or skipped) on a terminal job", async () => {
    const jobId = await makeJob();
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "ok.test" },
      { organizationId: null, locationId: null, domain: "skip.test" },
      { organizationId: null, locationId: null, domain: "fail.test" },
    ]);
    const items = await getApplePayJobItems(jobId);
    const ok = items.find((i) => i.domain === "ok.test")!;
    const skip = items.find((i) => i.domain === "skip.test")!;
    const fail = items.find((i) => i.domain === "fail.test")!;
    await claimAndCompleteApplePayJobItem(ok.id, { status: "succeeded" });
    await claimAndCompleteApplePayJobItem(skip.id, { status: "skipped", message: "n/a" });
    await claimAndCompleteApplePayJobItem(fail.id, { status: "failed", message: "boom" });
    await setJobStatus(jobId, "partial");

    expect(await retryApplePayJobItem(jobId, ok.id)).toBeUndefined();
    expect(await retryApplePayJobItem(jobId, skip.id)).toBeUndefined();
    // Crucially, the same item is retryable when its status IS failed.
    const okResult = await retryApplePayJobItem(jobId, fail.id);
    expect(okResult).toBeDefined();
  });

  it("refuses to retry when (jobId, itemId) belong to different jobs (cross-job scoping)", async () => {
    const jobAId = await makeJob();
    const jobBId = await makeJob();
    await insertApplePayJobItems(jobAId, [
      { organizationId: null, locationId: null, domain: "a.test" },
    ]);
    await insertApplePayJobItems(jobBId, [
      { organizationId: null, locationId: null, domain: "b.test" },
    ]);
    const [itemA] = await getApplePayJobItems(jobAId);
    await claimAndCompleteApplePayJobItem(itemA.id, { status: "failed", message: "x" });
    await setJobStatus(jobAId, "failed");
    await setJobStatus(jobBId, "failed");

    // Item belongs to A; pretend it was an item under B. Must be a no-op
    // and leave both jobs untouched.
    const result = await retryApplePayJobItem(jobBId, itemA.id);
    expect(result).toBeUndefined();

    const reloadedA = await getApplePayJob(jobAId);
    const reloadedB = await getApplePayJob(jobBId);
    expect(reloadedA?.status).toBe("failed");
    expect(reloadedB?.status).toBe("failed");
    const [reloadedItem] = await getApplePayJobItems(jobAId);
    expect(reloadedItem.status).toBe("failed");
  });

  it("returns undefined for a non-existent job or item", async () => {
    expect(await retryApplePayJobItem(2_147_483_002, 2_147_483_002)).toBeUndefined();

    const jobId = await makeJob();
    await setJobStatus(jobId, "failed");
    expect(await retryApplePayJobItem(jobId, 2_147_483_003)).toBeUndefined();
  });
});
