/**
 * Database invariants installed at startup.
 *
 * These mirror schema-level guarantees that cannot be expressed in the
 * Drizzle schema (currently: a BEFORE INSERT/UPDATE trigger). Running
 * them on every server boot keeps production, development and the test
 * environment in sync — the same function is invoked from
 * `server/index.ts` (production / dev) and `tests/setup/global-setup.ts`
 * (vitest).
 *
 * All statements are idempotent so repeated boots are safe.
 *
 * Why a trigger and not a CHECK constraint
 * ----------------------------------------
 * The orphan-data system-admin tooling has to fabricate legacy
 * org-less user rows in its fixtures. CHECK constraints cannot be
 * bypassed inside a single transaction, but a trigger can be
 * temporarily disabled with `ALTER TABLE ... DISABLE TRIGGER` (which
 * only takes SHARE ROW EXCLUSIVE) — keeping the test fixture from
 * blocking every other suite while it stages the orphan rows.
 */
import { sql } from 'drizzle-orm';
import { db } from './db';

export async function installDbInvariants(): Promise<void> {
  // Retire the legacy CHECK constraint of the same name if it still
  // exists from older schema versions.
  await db.execute(
    sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_org_required`,
  );

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
