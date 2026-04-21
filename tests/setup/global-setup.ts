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
 */
import { seedTestUsers } from './seed-test-users';
import { cleanup as closeDbPool } from '../../server/db';

export default async function setup() {
  if (process.env.SKIP_TEST_SEED !== '1') {
    await seedTestUsers();
  }

  return async function teardown() {
    await closeDbPool();
  };
}
