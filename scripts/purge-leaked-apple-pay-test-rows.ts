/**
 * One-shot purge for Apple Pay test-fixture rows that leaked from
 * crashed Vitest workers (#592).
 *
 * Idempotent — safe to re-run; no-ops if nothing matches.
 *
 * Narrow predicate (matches the documented test-fixture shape ONLY):
 *
 *   1. `created_by IS NULL`
 *      Production rows are always inserted with `req.user.id` from the
 *      `POST /apple-pay/register-all-domains` route. Only test fixtures
 *      and rows whose creator user has been deleted carry NULL here.
 *
 *   2. EVERY child item's `domain` matches a known test-fixture pattern:
 *        - `*.vitest-fixture.invalid` (the post-#592 sentinel TLD,
 *          including `.unit.vitest-fixture.invalid` and
 *          `.api.vitest-fixture.invalid` subdomain prefixes)
 *        - `*.test` (the legacy pattern from before the #592 rename;
 *          `.test` is reserved by RFC 2606 so it cannot collide with
 *          a real Apple Pay domain either)
 *
 * Both conditions must hold. A job that has at least one item whose
 * domain does NOT match either pattern is left alone (would be
 * non-fixture data we must not touch).
 *
 * Originally intended to delete leaked rows `13002`, `12453`, `12415`
 * mentioned in the task plan. By the time this script ran, those rows
 * had already been swept by ad-hoc cleanup; the script then deleted
 * one further leaked row (`13386`, items `a/b/c/d.test`) that only
 * surfaced after a subsequent crashed worker. The script is committed
 * so the same purge can be re-run in any other environment that still
 * has historical leaked rows.
 *
 * Usage:
 *   npx tsx scripts/purge-leaked-apple-pay-test-rows.ts          # actually delete
 *   npx tsx scripts/purge-leaked-apple-pay-test-rows.ts --dry    # preview only
 */
import { db } from "../server/db";
import { applePayJobs, applePayJobItems } from "@shared/schema";
import { isNull, sql } from "drizzle-orm";

const dryRun = process.argv.includes("--dry");

async function main(): Promise<void> {
  // Find candidate jobs that satisfy BOTH conditions: created_by IS
  // NULL AND no item exists whose domain falls outside the known
  // test-fixture patterns. The `NOT EXISTS (... non-matching item)`
  // arm is what guarantees the predicate is narrow — a single
  // non-fixture item disqualifies the whole job.
  const candidates = await db
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

  if (candidates.length === 0) {
    console.log("[purge-leaked-apple-pay-test-rows] OK — no leaked test-fixture rows found.");
    return;
  }

  console.log(
    `[purge-leaked-apple-pay-test-rows] Found ${candidates.length} candidate job(s):`,
  );
  for (const job of candidates) {
    console.log(`  job_id=${job.id} items=${JSON.stringify(job.itemDomains)}`);
  }

  if (dryRun) {
    console.log("[purge-leaked-apple-pay-test-rows] --dry: skipping delete.");
    return;
  }

  const ids = candidates.map((c) => c.id);
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
