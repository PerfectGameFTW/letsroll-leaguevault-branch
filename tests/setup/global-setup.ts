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
 */
import { seedTestUsers } from './seed-test-users';
import { cleanup as closeDbPool } from '../../server/db';
import { installDbInvariants } from '../../server/db-invariants';

export default async function setup() {
  await installDbInvariants();

  if (process.env.SKIP_TEST_SEED !== '1') {
    await seedTestUsers();
  }

  return async function teardown() {
    await closeDbPool();
  };
}
