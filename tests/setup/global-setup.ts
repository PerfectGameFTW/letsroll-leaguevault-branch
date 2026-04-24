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
 * Also installs the `users_role_org_required` invariant as a TRIGGER
 * (replacing the legacy CHECK constraint of the same name). A trigger is
 * required so the system-admin orphan-data fixtures can stage legacy
 * org-less user rows in parallel by toggling
 * `session_replication_role = replica` for the duration of a single
 * transaction (CHECK constraints can't be bypassed that way; triggers
 * can). The trigger enforces the same invariant the CHECK did for all
 * normal application traffic.
 */
import { sql } from 'drizzle-orm';
import { seedTestUsers } from './seed-test-users';
import { db, cleanup as closeDbPool } from '../../server/db';

async function installRoleOrgRequiredTrigger() {
  // Drop the legacy CHECK constraint if it still exists. Idempotent.
  await db.execute(
    sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_org_required`,
  );

  // Trigger function — same invariant the CHECK enforced.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION users_role_org_required_fn()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.role <> 'system_admin' AND NEW.organization_id IS NULL THEN
        RAISE EXCEPTION 'users_role_org_required: non-admin users must have organization_id'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);

  // Replace any prior trigger with the same name (idempotent).
  await db.execute(
    sql`DROP TRIGGER IF EXISTS users_role_org_required ON users`,
  );
  await db.execute(sql`
    CREATE TRIGGER users_role_org_required
    BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION users_role_org_required_fn();
  `);
}

export default async function setup() {
  await installRoleOrgRequiredTrigger();

  if (process.env.SKIP_TEST_SEED !== '1') {
    await seedTestUsers();
  }

  return async function teardown() {
    await closeDbPool();
  };
}
