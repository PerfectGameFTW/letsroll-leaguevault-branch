/**
 * One-shot purge for Apple Pay test-fixture rows that leaked from
 * crashed Vitest workers (#592, extended in #606).
 *
 * Idempotent — safe to re-run; no-ops if nothing matches.
 *
 * Two modes (both narrow, both can run independently):
 *
 * MODE 1 — sentinel-item shape (default, originally #592):
 *   1. `created_by IS NULL` — production rows are always inserted with
 *      `req.user.id`; only test fixtures (or rows whose creator was
 *      deleted) carry NULL here.
 *   2. The job HAS at least one item, AND every child item's `domain`
 *      matches a known test-fixture pattern:
 *        - `*.vitest-fixture.invalid` (post-#592 sentinel TLD,
 *          including `.unit.vitest-fixture.invalid` and
 *          `.api.vitest-fixture.invalid` sub-domains)
 *        - `*.test` (legacy pre-#592 pattern; `.test` is RFC 2606
 *          reserved so cannot collide with real Apple Pay domains)
 *
 * MODE 2 — item-less leak shape (added in #606, opt-in via `--include-empty`):
 *   1. `created_by IS NULL`
 *   2. ZERO child items
 *   3. `created_at` older than 60 seconds (matches the production
 *      empty-grace listing filter `APPLE_PAY_EMPTY_JOB_GRACE_MS`).
 *      The age threshold guarantees we never race-delete a real
 *      production job that is still mid-enumeration (those have a
 *      fresh created_at), or a fresh empty job from a concurrent
 *      Vitest worker.
 *
 * MODE 2 must be opted into explicitly because deleting any item-less
 * row is intrinsically more dangerous than deleting one whose items
 * we can fingerprint as test data — the operator should know they are
 * deleting jobs they cannot positively identify by content.
 *
 * Originally intended to delete leaked rows `13002`, `12453`, `12415`
 * mentioned in the original task plan. By the time this script ran,
 * those rows had already been swept by ad-hoc cleanup; the script then
 * deleted one further leaked row (`13386`, items `a/b/c/d.test`) that
 * only surfaced after a subsequent crashed worker. The script is
 * committed so the same purge can be re-run in any other environment
 * that still has historical leaked rows.
 *
 * Usage:
 *   npx tsx scripts/purge-leaked-apple-pay-test-rows.ts                     # mode 1, actually delete
 *   npx tsx scripts/purge-leaked-apple-pay-test-rows.ts --dry               # mode 1, preview only
 *   npx tsx scripts/purge-leaked-apple-pay-test-rows.ts --include-empty     # modes 1+2, actually delete
 *   npx tsx scripts/purge-leaked-apple-pay-test-rows.ts --include-empty --dry  # modes 1+2, preview only
 */
import { db } from "../server/db";
import { applePayJobs, applePayJobItems } from "@shared/schema";
import { isNull, sql } from "drizzle-orm";

const dryRun = process.argv.includes("--dry");
const includeEmpty = process.argv.includes("--include-empty");

async function findSentinelCandidates(): Promise<Array<{ id: number; itemDomains: string[] }>> {
  // Mode 1: created_by IS NULL AND has items AND no item is non-fixture.
  // The `NOT EXISTS (... non-matching item)` arm is what guarantees the
  // predicate is narrow — a single non-fixture item disqualifies the
  // whole job.
  return db
    .select({
      id: applePayJobs.id,
      itemDomains: sql<string[]>`COALESCE(
        (SELECT array_agg(${applePayJobItems.domain})
         FROM ${applePayJobItems}
         WHERE ${applePayJobItems.jobId} = ${applePayJobs.id}),
        ARRAY[]::text[]
      )`,
    })
    .from(applePayJobs)
    .where(
      sql`${isNull(applePayJobs.createdBy)}
        AND NOT EXISTS (
          SELECT 1 FROM ${applePayJobItems} i
          WHERE i.job_id = ${applePayJobs.id}
            AND i.domain NOT LIKE '%.vitest-fixture.invalid'
            AND i.domain NOT LIKE '%.test'
        )
        AND EXISTS (
          SELECT 1 FROM ${applePayJobItems} i
          WHERE i.job_id = ${applePayJobs.id}
        )`,
    );
}

async function findEmptyCandidates(): Promise<Array<{ id: number; createdAt: string }>> {
  // Mode 2 (#606): created_by IS NULL AND zero items AND age > 60s.
  // Mirrors the production empty-grace listing filter exactly so that
  // anything this query returns is already invisible to the admin
  // page — i.e. deletion is purely cleanup, not user-visible.
  return db
    .select({
      id: applePayJobs.id,
      createdAt: sql<string>`${applePayJobs.createdAt}::text`,
    })
    .from(applePayJobs)
    .where(
      sql`${isNull(applePayJobs.createdBy)}
        AND NOT EXISTS (
          SELECT 1 FROM ${applePayJobItems} i
          WHERE i.job_id = ${applePayJobs.id}
        )
        AND ${applePayJobs.createdAt} < NOW() - INTERVAL '60 seconds'`,
    );
}

async function main(): Promise<void> {
  const sentinelCandidates = await findSentinelCandidates();
  const emptyCandidates = includeEmpty ? await findEmptyCandidates() : [];

  if (sentinelCandidates.length === 0 && emptyCandidates.length === 0) {
    if (includeEmpty) {
      console.log("[purge-leaked-apple-pay-test-rows] OK — no sentinel-item or empty-job leaks found.");
    } else {
      console.log("[purge-leaked-apple-pay-test-rows] OK — no leaked test-fixture rows found.");
    }
    return;
  }

  if (sentinelCandidates.length > 0) {
    console.log(
      `[purge-leaked-apple-pay-test-rows] Mode 1 (sentinel): ${sentinelCandidates.length} candidate job(s):`,
    );
    for (const job of sentinelCandidates) {
      console.log(`  job_id=${job.id} items=${JSON.stringify(job.itemDomains)}`);
    }
  }

  if (emptyCandidates.length > 0) {
    console.log(
      `[purge-leaked-apple-pay-test-rows] Mode 2 (empty + created_by IS NULL + age>60s): ${emptyCandidates.length} candidate job(s):`,
    );
    for (const job of emptyCandidates) {
      console.log(`  job_id=${job.id} created_at=${job.createdAt}`);
    }
  }

  if (dryRun) {
    console.log("[purge-leaked-apple-pay-test-rows] --dry: skipping delete.");
    return;
  }

  const ids = [
    ...sentinelCandidates.map((c) => c.id),
    ...emptyCandidates.map((c) => c.id),
  ];
  const deleted = await db
    .delete(applePayJobs)
    .where(sql`${applePayJobs.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
    .returning({ id: applePayJobs.id });
  console.log(
    `[purge-leaked-apple-pay-test-rows] Deleted ${deleted.length} job(s) (cascaded items).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[purge-leaked-apple-pay-test-rows] FAILED:", err);
    process.exit(1);
  });
