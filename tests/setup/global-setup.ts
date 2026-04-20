/**
 * Vitest globalSetup: ensures the test accounts exist before any test runs.
 * Skipped automatically when SKIP_TEST_SEED=1 (e.g. for CI environments
 * that already seed the DB out-of-band).
 */
import { seedTestUsers } from './seed-test-users';

export default async function setup() {
  if (process.env.SKIP_TEST_SEED === '1') {
    return;
  }
  await seedTestUsers();
}
