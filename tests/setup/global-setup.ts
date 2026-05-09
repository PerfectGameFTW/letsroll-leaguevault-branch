/**
 * Vitest globalSetup: ensures the test accounts exist before any test runs
 * and tears down the shared pg pool when the suite finishes.
 *
 * Skipped automatically when SKIP_TEST_SEED=1 (e.g. for CI environments
 * that already seed the DB out-of-band).
 *
 * Returning a teardown function from globalSetup is the documented vitest
 * hook for releasing process-wide resources. Without this, the pg pool's
 * idle clients (idleTimeoutMillis = 30s in server/db.ts) keep the event
 * loop alive after the last test resolves, which is what produced the
 * "close timed out after 10000ms" warning on every run.
 *
 * Also installs schema invariants (currently the
 * `users_role_org_required` trigger) via `installDbInvariants`. The same
 * function runs on production server boot in `server/index.ts`, so the
 * test environment and production stay in sync. The trigger replaces the
 * legacy CHECK constraint of the same name; orphan-data fixtures need a
 * trigger because triggers can be temporarily disabled for one
 * transaction (CHECK constraints cannot).
 *
 * Finally, the teardown asserts the dev DB does not contain orphan-audit
 * fixture leaks (Task #629). #608 hardened the
 * `tests/api/orphaned-data-audits.test.ts` afterAll cleanup, and #616
 * one-shot-purged the historical accumulation; this assertion is the
 * detection layer that fails the test workflow on the next regression
 * instead of silently letting rows pile up. Bypass with
 * `SKIP_AUDIT_LEAK_CHECK=1` only when you already know the dev DB is in
 * a known-bad state and you're explicitly running the suite to gather
 * other signal — never disable it in CI.
 */
import {
  checkLeakedAudits,
  formatLeakReport,
} from '../../scripts/check-no-leaked-audits';
import { seedTestUsers } from './seed-test-users';
import { cleanup as closeDbPool } from '../../server/db';
import { installDbInvariants } from '../../server/db-invariants';

/**
 * Vitest invokes `globalSetup` once per *project*, and `vitest.config.ts`
 * defines three projects (`serial-fk-bypass`, `parallel`,
 * `client-components`). Both `installDbInvariants()` (idempotent
 * trigger + table installs) and `seedTestUsers()` (idempotent upserts
 * of the fixture user/org/league rows) are pure waste on the second
 * and third project boots.
 *
 * The vitest worker boundary respects Node module identity within a
 * single process, so a module-level promise survives across project
 * setups in the same `npm test` invocation. Guard each expensive call
 * with a memoized promise so it runs exactly once across the whole
 * test workflow. (#688)
 */
let installInvariantsPromise: Promise<void> | null = null;
let seedUsersPromise: Promise<void> | null = null;

function memoizedInstallInvariants(): Promise<void> {
  if (installInvariantsPromise === null) {
    installInvariantsPromise = installDbInvariants();
  }
  return installInvariantsPromise;
}

function memoizedSeedTestUsers(): Promise<void> {
  if (seedUsersPromise === null) {
    seedUsersPromise = seedTestUsers();
  }
  return seedUsersPromise;
}

export default async function setup() {
  await memoizedInstallInvariants();

  if (process.env.SKIP_TEST_SEED !== '1') {
    await memoizedSeedTestUsers();
  }

  return async function teardown() {
    let leakError: Error | null = null;
    if (process.env.SKIP_AUDIT_LEAK_CHECK !== '1') {
      try {
        const { counts, samples, seededAdminId } = await checkLeakedAudits();
        const report = formatLeakReport(counts, samples, seededAdminId);
        if (report !== null) {
          leakError = new Error(report);
        }
      } catch (err) {
        // Surface query errors as a leak-check failure so the operator
        // sees that the tripwire ran and crashed (vs. silently passing).
        leakError = err instanceof Error ? err : new Error(String(err));
      }
    }
    // Always attempt to close the pool so the event loop can exit, but
    // never let a close-time error mask the primary leak signal — the
    // leak report is the actionable surface, pool-close failures are not.
    try {
      await closeDbPool();
    } catch (closeErr) {
      if (leakError === null) {
        throw closeErr;
      }
      console.error(
        '[global-setup] closeDbPool() also failed during teardown; surfacing the leak error instead:',
        closeErr,
      );
    }
    if (leakError !== null) {
      throw leakError;
    }
  };
}
