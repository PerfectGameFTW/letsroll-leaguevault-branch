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
import { inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { applePayJobs } from "@shared/schema";
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
} from "../../server/storage/apple-pay-jobs";

const createdJobIds: number[] = [];

async function makeJob(): Promise<number> {
  const job = await createApplePayJob(null);
  createdJobIds.push(job.id);
  return job.id;
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

    const [a, b] = await Promise.all([
      claimNextApplePayJob(),
      claimNextApplePayJob(),
    ]);

    const winners = [a, b].filter((j) => j?.id === jobId);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.status).toBe("running");

    // The losing call either claimed something else (none exists in this
    // test) or returned undefined. In our isolated test we expect undefined.
    const loser = [a, b].find((j) => j?.id !== jobId);
    expect(loser).toBeUndefined();

    // A subsequent claim should not re-pick the now-running job.
    const followUp = await claimNextApplePayJob();
    expect(followUp?.id).not.toBe(jobId);
  });

  it("claimNextApplePayJob ignores rows already in 'running'", async () => {
    const jobId = await makeJob();
    const first = await claimNextApplePayJob();
    expect(first?.id).toBe(jobId);

    // No other pending job exists, so the second claim must be undefined —
    // the running row must NOT be re-claimed.
    const second = await claimNextApplePayJob();
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

    // Simulate an interrupted run: enumerate items, claim the job
    // (status -> running), finish a few items, then "crash" leaving the
    // rest pending and the job stuck in running.
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "done-1.test" },
      { organizationId: null, locationId: null, domain: "done-2.test" },
      { organizationId: null, locationId: null, domain: "todo-1.test" },
      { organizationId: null, locationId: null, domain: "todo-2.test" },
    ]);
    const claimed = await claimNextApplePayJob();
    expect(claimed?.id).toBe(jobId);
    expect(claimed?.status).toBe("running");

    const items = await getApplePayJobItems(jobId);
    await updateApplePayJobItem(items[0].id, { status: "succeeded" });
    await updateApplePayJobItem(items[1].id, { status: "failed", message: "boom" });

    // -- crash boundary: job row is still 'running', items 2 & 3 still pending.

    // After-restart bookkeeping.
    const revived = await recoverInterruptedApplePayJobs();
    expect(revived).toBeGreaterThanOrEqual(1);
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
    const reclaimed = await claimNextApplePayJob();
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

  it("recoverInterruptedApplePayJobs revives items orphaned in 'processing' by a crashed worker", async () => {
    const jobId = await makeJob();
    await insertApplePayJobItems(jobId, [
      { organizationId: null, locationId: null, domain: "orphan-1.test" },
      { organizationId: null, locationId: null, domain: "orphan-2.test" },
      { organizationId: null, locationId: null, domain: "done.test" },
    ]);
    const items = await getApplePayJobItems(jobId);
    const orphan1 = items.find((it) => it.domain === "orphan-1.test")!;
    const orphan2 = items.find((it) => it.domain === "orphan-2.test")!;
    const done = items.find((it) => it.domain === "done.test")!;

    // Two items get pre-claimed but the worker crashes before writing
    // their terminal state. A third already finished cleanly.
    expect(await claimApplePayJobItemForProcessing(orphan1.id)).toBe(true);
    expect(await claimApplePayJobItemForProcessing(orphan2.id)).toBe(true);
    await claimAndCompleteApplePayJobItem(done.id, { status: "succeeded" });

    // -- crash boundary --

    await recoverInterruptedApplePayJobs();

    const reloaded = await getApplePayJobItems(jobId);
    const byDomain = Object.fromEntries(reloaded.map((it) => [it.domain, it.status]));
    expect(byDomain["orphan-1.test"]).toBe("pending");
    expect(byDomain["orphan-2.test"]).toBe("pending");
    // Already-terminal items must not be touched by the recovery sweep.
    expect(byDomain["done.test"]).toBe("succeeded");

    // The next worker pass must see exactly the two orphans as pending.
    const pending = await getPendingApplePayJobItems(jobId);
    expect(pending.map((it) => it.domain).sort()).toEqual([
      "orphan-1.test",
      "orphan-2.test",
    ]);
  });
});
