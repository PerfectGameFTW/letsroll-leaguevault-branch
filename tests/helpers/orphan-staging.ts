/**
 * Helpers for staging "legacy" orphan rows that the system-admin
 * orphan-data feature is meant to clean up.
 *
 * Why this exists
 * ------------------------------------------------------------------
 * The orphan-data test suites have to fabricate two row shapes that
 * the live schema would normally reject:
 *
 *   1. Child rows (teams / bowler_leagues / payments) whose `league_id`
 *      points at a league that does not exist. Blocked by the FK
 *      constraint `<table>_league_id_leagues_id_fk`.
 *
 *   2. Non-`system_admin` user rows with `organization_id IS NULL`.
 *      Blocked by the `users_role_org_required` BEFORE INSERT trigger
 *      that is installed by `tests/setup/global-setup.ts`.
 *
 * Each helper opens a tight single-statement-window transaction so the
 * required DDL is held only for the duration of one INSERT and then
 * immediately restored, instead of being dropped for the full test
 * file (which is what blocked file-parallel test execution).
 *
 * Lock impact
 * ------------------------------------------------------------------
 * - `insertChildBypassingLeagueFk`: takes ACCESS EXCLUSIVE on the
 *   target child table for ~tens of milliseconds (one DROP + one ADD
 *   CONSTRAINT). Sibling sessions writing to the same table briefly
 *   wait but never fail. The constraint is re-added as `NOT VALID` so
 *   the orphan row we just inserted does not block the operation; new
 *   writes are still validated. Call `validateLeagueFk(<table>)` from
 *   `afterAll` once the orphan rows have been deleted to mark the
 *   constraint VALID again.
 *
 * - `insertOrphanUser`: takes only SHARE ROW EXCLUSIVE on `users`
 *   (DISABLE/ENABLE TRIGGER is much cheaper than DROP CONSTRAINT) and
 *   is similarly tight.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../server/db';
import { users, type User } from '@shared/schema';
import type { PgTable } from 'drizzle-orm/pg-core';

type ChildTableName = 'teams' | 'bowler_leagues' | 'payments';

function fkConstraintName(tableName: ChildTableName): string {
  return `${tableName}_league_id_leagues_id_fk`;
}

/**
 * Insert a row whose `league_id` references a non-existent league by
 * temporarily lifting the FK constraint inside a single transaction.
 * Returns the freshly-inserted row's `id`.
 */
export async function insertChildBypassingLeagueFk<T extends PgTable>(
  table: T,
  tableName: ChildTableName,
  values: Record<string, unknown>,
): Promise<number> {
  const constraint = fkConstraintName(tableName);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${constraint}`),
    );
    const inserted = await tx
      .insert(table)
      // drizzle's typings don't know which fields a generic table has;
      // callers supply a complete row literal.
      .values(values as never)
      .returning({ id: sql<number>`id` });
    await tx.execute(
      sql.raw(
        `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraint} ` +
          `FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE NOT VALID`,
      ),
    );
    return inserted[0].id;
  });
}

/**
 * After the orphan rows have been cleaned up in `afterAll`, mark the
 * FK constraint VALID again so the schema doesn't drift to a
 * permanently NOT-VALID state across repeated test runs.
 *
 * VALIDATE CONSTRAINT takes only SHARE UPDATE EXCLUSIVE — it does not
 * block reads or writes on the table.
 */
export async function validateLeagueFk(tableName: ChildTableName): Promise<void> {
  const constraint = fkConstraintName(tableName);
  try {
    await db.execute(
      sql.raw(`ALTER TABLE ${tableName} VALIDATE CONSTRAINT ${constraint}`),
    );
  } catch {
    // best-effort — the constraint may have been dropped or re-added
    // in another concurrent suite; the next test run will repair it.
  }
}

/**
 * Insert a non-`system_admin` user row with `organization_id IS NULL`
 * by briefly disabling the `users_role_org_required` trigger.
 * Returns the freshly-inserted user.
 */
export async function insertOrphanUser(
  values: Omit<typeof users.$inferInsert, 'organizationId'> & { organizationId?: null },
): Promise<User> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE users DISABLE TRIGGER users_role_org_required`,
    );
    try {
      const [row] = await tx
        .insert(users)
        .values({ ...values, organizationId: null })
        .returning();
      return row;
    } finally {
      await tx.execute(
        sql`ALTER TABLE users ENABLE TRIGGER users_role_org_required`,
      );
    }
  });
}
