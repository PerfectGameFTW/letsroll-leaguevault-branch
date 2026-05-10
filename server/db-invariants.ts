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
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@shared/schema';
import { db as defaultDb } from './db';

export type AnyDb = NodePgDatabase<typeof schema>;

export async function installDbInvariants(db: AnyDb = defaultDb): Promise<void> {
  // Serialise concurrent boots against the SAME DB. Task #722's
  // deterministic per-pool test-DB naming means a recycled fork (or a
  // sibling test-app spawn under `parallel-isolated`) can boot a fresh
  // app process against a DB that another boot is mid-install on. The
  // DROP TRIGGER IF EXISTS / CREATE TRIGGER pair below isn't atomic by
  // itself, so two concurrent installers can race past the DROP and
  // both attempt CREATE — yielding `trigger ... already exists`. A
  // session-scoped advisory lock (released by the implicit unlock at
  // session end) costs ~nothing and makes the install atomic per-DB.
  // Lock key derived from the function name; arbitrary but stable.
  await db.execute(sql`SELECT pg_advisory_lock(7220001)`);
  try {
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

  // Task #356 follow-up: ensure the shared rate-limit bucket table
  // exists. It deliberately lives outside `shared/schema.ts` because
  // the application never accesses it through Drizzle — every read
  // and write goes through the raw SQL in
  // `server/utils/rate-limit-store.ts`, which is what the
  // express-rate-limit `Store` interface expects. That means
  // `npm run db:push` (driven by `shared/schema.ts`) doesn't know
  // about it, and the matching SQL file
  // `migrations/0028_add_rate_limit_buckets.sql` isn't executed by
  // anything in the deployment pipeline either — `drizzle-kit push`
  // doesn't replay raw migration files. Without this block the table
  // exists in environments where someone happened to apply 0028 by
  // hand and is missing everywhere else, including the CI Postgres
  // container, which made `tests/unit/rate-limit-store.test.ts` fail
  // with `relation "rate_limit_buckets" does not exist`. Creating the
  // table here keeps this in lockstep with the trigger above: every
  // boot path (prod, dev, vitest globalSetup) lands on the same
  // schema, idempotently.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      key       text PRIMARY KEY,
      count     integer NOT NULL DEFAULT 0,
      reset_at  timestamptz NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS rate_limit_buckets_reset_at_idx
      ON rate_limit_buckets (reset_at);
  `);
  } finally {
    try {
      await db.execute(sql`SELECT pg_advisory_unlock(7220001)`);
    } catch {
      /* lock auto-releases at session end; non-fatal */
    }
  }
}
