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
  // app process against a DB another boot is mid-install on. The DROP
  // TRIGGER IF EXISTS / CREATE TRIGGER pair below isn't atomic by
  // itself, so two concurrent installers can race past the DROP and
  // both attempt CREATE — yielding `trigger ... already exists`.
  //
  // We wrap the install in `db.transaction()` (Drizzle pins the
  // transaction to a single pg client) and acquire
  // `pg_advisory_xact_lock(7220001)` inside it. Transaction-scoped
  // advisory locks are bound to that pinned connection by definition,
  // and Postgres releases them automatically at COMMIT/ROLLBACK — no
  // chance of leaking a lock onto a pooled connection that goes back to
  // the pool while still holding it. CREATE FUNCTION / DROP TRIGGER /
  // CREATE TRIGGER / CREATE TABLE IF NOT EXISTS are all transactional
  // in Postgres, so the entire install is atomic per-DB.
  // Lock key derived from the function name; arbitrary but stable.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7220001)`);

    // Retire the legacy CHECK constraint of the same name if it still
    // exists from older schema versions.
    await tx.execute(
      sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_org_required`,
    );

    await tx.execute(sql`
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

    await tx.execute(
      sql`DROP TRIGGER IF EXISTS users_role_org_required ON users`,
    );
    await tx.execute(sql`
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
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        key       text PRIMARY KEY,
        count     integer NOT NULL DEFAULT 0,
        reset_at  timestamptz NOT NULL
      );
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS rate_limit_buckets_reset_at_idx
        ON rate_limit_buckets (reset_at);
    `);

    // Task #735 (League Secretary): the route layer is responsible for
    // setting `league_secretaries.organization_id` to the parent
    // league's `organization_id`, but a buggy future caller, a stale
    // copy/paste, or a direct SQL operation could quietly stamp it
    // with a different org and grant cross-tenant powers (org A's
    // secretary suddenly has admin powers on a league in org B). A
    // BEFORE INSERT/UPDATE trigger keeps the matching-org invariant
    // enforced at the DB layer regardless of which path inserted the
    // row. Idempotent install per the file-level convention.
    await tx.execute(sql`
      CREATE OR REPLACE FUNCTION league_secretary_org_match_fn()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        league_org_id integer;
      BEGIN
        SELECT organization_id INTO league_org_id FROM leagues WHERE id = NEW.league_id;
        IF league_org_id IS NULL THEN
          RAISE EXCEPTION 'league_secretary_org_match: league % has no organization_id (org-less rows are not eligible for secretary grants)', NEW.league_id
            USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.organization_id <> league_org_id THEN
          RAISE EXCEPTION 'league_secretary_org_match: league_secretaries.organization_id (%) must match league %.organization_id (%)', NEW.organization_id, NEW.league_id, league_org_id
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    // The table may not yet exist on the very first boot after a fresh
    // schema where `npm run db:push` has not run. Both the DROP and the
    // CREATE reference `league_secretaries` and would error on a missing
    // relation, so guard the entire drop/create pair with an existence
    // check (DROP TRIGGER IF EXISTS still requires the table to exist).
    await tx.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'league_secretaries'
        ) THEN
          EXECUTE 'DROP TRIGGER IF EXISTS league_secretaries_org_match ON league_secretaries';
          EXECUTE 'CREATE TRIGGER league_secretaries_org_match
            BEFORE INSERT OR UPDATE ON league_secretaries
            FOR EACH ROW
            EXECUTE FUNCTION league_secretary_org_match_fn()';
        END IF;
      END $$;
    `);
  });
}
