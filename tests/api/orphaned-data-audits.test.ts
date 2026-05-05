import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, eq, and, gt, gte, asc } from 'drizzle-orm';
import { insertOrphanUser } from '../helpers/orphan-staging';
import { db } from '../../server/db';
import {
  leagues,
  teams,
  bowlers,
  bowlerLeagues,
  payments,
  users,
  organizations,
  orphanCleanupAudits,
  type OrphanCleanupAudit,
} from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import {
  login,
  apiGet,
  apiPost,
  type AuthSession,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

interface CleanupAuditRowDTO extends OrphanCleanupAudit {
  adminUserName: string | null;
  adminUserEmail: string | null;
  organizationName: string | null;
}

const BOGUS_LEAGUE_ID = 2_000_000_001;

/**
 * Asserts the audit table is the source of truth for org-less cleanup
 * actions. Every successful reassign/delete on every supported resource
 * type must write a matching row to `orphan_cleanup_audits`; every
 * failure path (validation, not-orphaned, not-found, unauthorized) must
 * NOT write a row. Also covers the GET listing endpoint (admin gating
 * and the limit clamp).
 */
describe('Orphaned cleanup audit logging (system-admin)', () => {
  let admin: AuthSession;
  let orgAdmin: AuthSession;
  let targetOrgId: number;

  // Resources used by the success-path block. Each gets exactly one
  // repair action that we then assert produced an audit row.
  let leagueForReassign = 0;
  let leagueForDelete = 0;
  let teamForDelete = 0;
  let bowlerLeagueForDelete = 0;
  let paymentForDelete = 0;
  let userForReassign = 0;
  let userForDelete = 0;

  // Held-back orphan league + bowler used as the FK parent for child
  // resources that get deleted in the success block. We delete it last.
  let parentOrphanLeagueId = 0;
  let bowlerId = 0;

  // Resources used for failure-path assertions (must remain untouched).
  let nonOrphanLeagueId = 0;
  let nonOrphanUserId = 0;

  // Append-only registry of every row id we insert in `beforeAll`,
  // captured so `afterAll` cleanup is not blinded by test bodies that
  // zero out their per-test variables (e.g. `userForDelete = 0`)
  // after the route under test has already deleted the row. Without
  // this, the matching audit row was leaked on every run because the
  // cleanup loops below all guarded on `if (id)` and saw 0.
  const inserted = {
    leagues: [] as number[],
    teams: [] as number[],
    bowlerLeagues: [] as number[],
    payments: [] as number[],
    bowlers: [] as number[],
    users: [] as number[],
  };

  // High-water mark of the audit table at the start of every test, so we
  // can assert which audit rows (if any) were produced by the action
  // under test without depending on prior history.
  let auditWatermark = 0;

  // Captured at the start of `beforeAll`, used by the afterAll safety-net
  // delete. Even when the per-id registry loop misses a row (e.g. a flaky
  // worker termination interrupted the loop, or a future test variant
  // forgot to push into `inserted`), the time-windowed sweep below
  // catches every audit row this suite's admin authored during the run
  // and prevents leaks from reaching the global teardown tripwire (#629).
  // String form because `orphan_cleanup_audits.created_at` is declared
  // with `mode: "string"` in shared/schema/orphan-cleanup-audits.ts; the
  // drizzle column expects a string for comparisons.
  let suiteStartedAt = '1970-01-01 00:00:00';

  async function refreshWatermark() {
    const [row] = await db
      .select({ value: sql<number>`coalesce(max(${orphanCleanupAudits.id}), 0)::int` })
      .from(orphanCleanupAudits);
    auditWatermark = Number(row?.value ?? 0);
  }

  // Audit-row reads must be scoped to the resource we just operated on.
  // Sibling test files run concurrently and write their own audit rows
  // for unrelated resources; without scoping, those would leak into our
  // assertions. The watermark by itself is not enough because audit IDs
  // grow globally.
  async function newAuditRows(scope?: { resourceType: string; resourceId: number }) {
    const rows = await db
      .select()
      .from(orphanCleanupAudits)
      .where(gt(orphanCleanupAudits.id, auditWatermark))
      .orderBy(asc(orphanCleanupAudits.id));
    if (!scope) return rows;
    return rows.filter(
      (r) => r.resourceType === scope.resourceType && r.resourceId === scope.resourceId,
    );
  }

  beforeAll(async () => {
    // Captured BEFORE any login/insert so the safety-net sweep in
    // afterAll covers every audit row this suite could possibly create.
    suiteStartedAt = new Date().toISOString().replace('T', ' ').replace('Z', '');
    admin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    orgAdmin = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);

    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .limit(1);
    if (!org) throw new Error('No organization available for audit tests');
    targetOrgId = org.id;

    // `leagues.organization_id` is nullable in the schema, so org-less
    // leagues are inserted directly. This suite never references a
    // non-existent parent league, so no FK bypass is needed. The two
    // org-less user rows are inserted via `insertOrphanUser`, which
    // briefly disables the `users_role_org_required` trigger inside a
    // single transaction.

    const leagueDefaults = {
      seasonStart: '2025-01-01 00:00:00',
      seasonEnd: '2025-12-31 00:00:00',
      weekDay: 'Monday' as const,
    };

    const insertOrphanLeague = async (name: string) => {
      const [row] = await db
        .insert(leagues)
        .values({ name, ...leagueDefaults, organizationId: null as unknown as number })
        .returning({ id: leagues.id });
      inserted.leagues.push(row.id);
      return row.id;
    };

    leagueForReassign = await insertOrphanLeague('Vitest Audit Orphan League (reassign)');
    leagueForDelete = await insertOrphanLeague('Vitest Audit Orphan League (delete)');
    parentOrphanLeagueId = await insertOrphanLeague('Vitest Audit Parent Orphan League');

    const [ln] = await db
      .insert(leagues)
      .values({
        name: 'Vitest Audit Non-Orphan League',
        ...leagueDefaults,
        organizationId: targetOrgId,
      })
      .returning({ id: leagues.id });
    nonOrphanLeagueId = ln.id;
    inserted.leagues.push(nonOrphanLeagueId);

    const [bw] = await db
      .insert(bowlers)
      .values({ name: 'Vitest Audit Bowler', organizationId: targetOrgId })
      .returning({ id: bowlers.id });
    bowlerId = bw.id;
    inserted.bowlers.push(bowlerId);

    const [t1] = await db
      .insert(teams)
      .values({ name: 'Vitest Audit Orphan Team', number: 9981, leagueId: parentOrphanLeagueId })
      .returning({ id: teams.id });
    teamForDelete = t1.id;
    inserted.teams.push(teamForDelete);

    const [bl1] = await db
      .insert(bowlerLeagues)
      .values({ bowlerId, leagueId: parentOrphanLeagueId, teamId: teamForDelete })
      .returning({ id: bowlerLeagues.id });
    bowlerLeagueForDelete = bl1.id;
    inserted.bowlerLeagues.push(bowlerLeagueForDelete);

    const [p1] = await db
      .insert(payments)
      .values({
        bowlerId,
        leagueId: parentOrphanLeagueId,
        amount: 100,
        weekOf: '2025-01-06 00:00:00',
        type: 'cash',
      })
      .returning({ id: payments.id });
    paymentForDelete = p1.id;
    inserted.payments.push(paymentForDelete);

    const pwd = await hashPassword('Throwaway-Password-123!');
    const stamp = Date.now();

    const u1 = await insertOrphanUser({
      email: `vitest-audit-orphan-reassign-${stamp}@example.com`,
      password: pwd,
      name: 'Vitest Audit Orphan User (reassign)',
      role: 'user',
    });
    userForReassign = u1.id;
    inserted.users.push(userForReassign);

    const u2 = await insertOrphanUser({
      email: `vitest-audit-orphan-delete-${stamp}@example.com`,
      password: pwd,
      name: 'Vitest Audit Orphan User (delete)',
      role: 'user',
    });
    userForDelete = u2.id;
    inserted.users.push(userForDelete);

    const [u3] = await db
      .insert(users)
      .values({
        email: `vitest-audit-nonorphan-${stamp}@example.com`,
        password: pwd,
        name: 'Vitest Audit Non-Orphan User',
        role: 'user',
        organizationId: targetOrgId,
      })
      .returning({ id: users.id });
    nonOrphanUserId = u3.id;
    inserted.users.push(nonOrphanUserId);
  });

  afterAll(async () => {
    // Cleanup contract:
    //  - Every row this suite inserted in `beforeAll` must be deleted
    //    here, OR have already been deleted by the route under test
    //    (in which case the matching DELETE here is a no-op).
    //  - Any failure to delete a row is loud — logged with table+id
    //    context AND collected so the suite fails at the end. The
    //    previous `catch { /* best effort */ }` silently leaked rows
    //    (and FK errors) into the dev database on every run.
    //  - All deletes are still attempted even when one fails, so a
    //    single bad row doesn't block the rest of cleanup.
    const failures: Array<{ label: string; error: unknown }> = [];
    const tryRun = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        failures.push({ label, error });
        console.error(`[orphan-audits cleanup] ${label} failed:`, error);
      }
    };

    // Audit rows must go before the rows they reference, even though
    // `orphan_cleanup_audits.resource_id` is a plain integer column
    // (no FK), so that the audit table doesn't grow forever across
    // repeated runs against the same dev database. We iterate the
    // append-only `inserted` registry rather than the per-test
    // variables — those get zeroed by the success-path tests
    // (e.g. `userForDelete = 0`) and would otherwise hide their own
    // audit rows from cleanup.
    const auditTargets: Array<{ type: string; id: number }> = [
      ...inserted.leagues.map((id) => ({ type: 'leagues', id })),
      ...inserted.teams.map((id) => ({ type: 'teams', id })),
      ...inserted.bowlerLeagues.map((id) => ({ type: 'bowlerLeagues', id })),
      ...inserted.payments.map((id) => ({ type: 'payments', id })),
      ...inserted.users.map((id) => ({ type: 'users', id })),
    ];
    for (const { type, id } of auditTargets) {
      await tryRun(`orphan_cleanup_audits ${type}:${id}`, () =>
        db.delete(orphanCleanupAudits).where(and(
          eq(orphanCleanupAudits.resourceType, type),
          eq(orphanCleanupAudits.resourceId, id),
        )),
      );
    }

    // Safety net: the per-id loop above is the documented contract, but
    // it has historically leaked rows under full-suite runs (#636) when
    // a transient failure mid-loop or a registry-vs-route mismatch let
    // a single audit row escape. The global teardown tripwire (#629)
    // then fails the whole `npm test` invocation. To keep the contract
    // self-healing without weakening it, we follow up with an
    // unconditional sweep of any `orphan_cleanup_audits` row written by
    // *this suite's admin* between `suiteStartedAt` and now. The window
    // is tight enough to never touch rows from sibling suites
    // (`orphaned-data.test.ts` runs in the same serial worker but
    // strictly *after* this file by alphabetical order, so its writes
    // fall outside this window), and the admin scope is the same admin
    // that authored every audit row this suite produced.
    if (admin?.user?.id) {
      await tryRun('orphan_cleanup_audits safety-net by admin+window', () =>
        db.delete(orphanCleanupAudits).where(and(
          eq(orphanCleanupAudits.adminUserId, admin.user.id),
          gte(orphanCleanupAudits.createdAt, suiteStartedAt),
        )),
      );
    }

    // Resource rows themselves. Children before parents:
    // payments / bowler_leagues / teams cascade off `leagues`, but we
    // delete them explicitly so a stray FK regression surfaces here
    // with a clear label instead of being masked by the cascade.
    // Users have no FK into the rows above, so order between users
    // and the league/team tree doesn't matter — but the inserted
    // user rows do need to go before the cleanup helpers in
    // `tests/helpers.ts releaseFixtureOrg` would (they don't run for
    // this suite; this is just a note for the next reader).
    for (const id of inserted.users) {
      await tryRun(`users:${id}`, () => db.delete(users).where(eq(users.id, id)));
    }
    for (const id of inserted.payments) {
      await tryRun(`payments:${id}`, () => db.delete(payments).where(eq(payments.id, id)));
    }
    for (const id of inserted.bowlerLeagues) {
      await tryRun(`bowler_leagues:${id}`, () => db.delete(bowlerLeagues).where(eq(bowlerLeagues.id, id)));
    }
    for (const id of inserted.teams) {
      await tryRun(`teams:${id}`, () => db.delete(teams).where(eq(teams.id, id)));
    }
    for (const id of inserted.bowlers) {
      await tryRun(`bowlers:${id}`, () => db.delete(bowlers).where(eq(bowlers.id, id)));
    }
    for (const id of inserted.leagues) {
      await tryRun(`leagues:${id}`, () => db.delete(leagues).where(eq(leagues.id, id)));
    }

    if (failures.length > 0) {
      const summary = failures
        .map((f) => `  - ${f.label}: ${(f.error as Error)?.message ?? String(f.error)}`)
        .join('\n');
      throw new Error(
        `orphan-audits afterAll cleanup had ${failures.length} failure(s):\n${summary}`,
      );
    }
  });

  // -------------------------------------------------------------------
  // Failure paths: NO audit row may be written when the repair fails
  // -------------------------------------------------------------------

  describe('failure paths never write audit rows', () => {
    it('rejected reassign of a child resource type (teams) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/teams/${teamForDelete}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(400);
      expect(await newAuditRows({ resourceType: 'teams', resourceId: teamForDelete })).toEqual([]);
    });

    it('reassign of non-existent league (404) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${BOGUS_LEAGUE_ID}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(404);
      expect(await newAuditRows({ resourceType: 'leagues', resourceId: BOGUS_LEAGUE_ID })).toEqual([]);
    });

    it('reassign of a non-orphan league (409) writes nothing', async () => {
      await refreshWatermark();
      const { status, data } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${nonOrphanLeagueId}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(409);
      expect(data.error?.code).toBe('NOT_ORPHANED');
      expect(await newAuditRows({ resourceType: 'leagues', resourceId: nonOrphanLeagueId })).toEqual([]);
    });

    it('reassign of a non-orphan user (409) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/users/${nonOrphanUserId}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(409);
      expect(await newAuditRows({ resourceType: 'users', resourceId: nonOrphanUserId })).toEqual([]);
    });

    it('delete of non-existent league (404) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${BOGUS_LEAGUE_ID}/delete`,
        {},
        admin,
      );
      expect(status).toBe(404);
      expect(await newAuditRows({ resourceType: 'leagues', resourceId: BOGUS_LEAGUE_ID })).toEqual([]);
    });

    it('delete of non-existent team (404) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/teams/${BOGUS_LEAGUE_ID}/delete`,
        {},
        admin,
      );
      expect(status).toBe(404);
      expect(await newAuditRows({ resourceType: 'teams', resourceId: BOGUS_LEAGUE_ID })).toEqual([]);
    });

    it('delete of a non-orphan league (409) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${nonOrphanLeagueId}/delete`,
        {},
        admin,
      );
      expect(status).toBe(409);
      expect(await newAuditRows({ resourceType: 'leagues', resourceId: nonOrphanLeagueId })).toEqual([]);
    });

    it('delete of a non-orphan user (409) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/users/${nonOrphanUserId}/delete`,
        {},
        admin,
      );
      expect(status).toBe(409);
      expect(await newAuditRows({ resourceType: 'users', resourceId: nonOrphanUserId })).toEqual([]);
    });

    it('unauthorized reassign (org admin, not system admin) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${leagueForReassign}/reassign`,
        { organizationId: targetOrgId },
        orgAdmin,
      );
      expect(status).toBe(403);
      expect(await newAuditRows({ resourceType: 'leagues', resourceId: leagueForReassign })).toEqual([]);
    });

    it('unauthorized delete (org admin, not system admin) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${leagueForDelete}/delete`,
        {},
        orgAdmin,
      );
      expect(status).toBe(403);
      expect(await newAuditRows({ resourceType: 'leagues', resourceId: leagueForDelete })).toEqual([]);
    });

    it('unauthenticated reassign writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${leagueForReassign}/reassign`,
        { organizationId: targetOrgId },
      );
      expect([401, 403]).toContain(status);
      expect(await newAuditRows({ resourceType: 'leagues', resourceId: leagueForReassign })).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // Success paths: every repair on every resource type writes an audit
  // -------------------------------------------------------------------

  describe('success paths write a matching audit row', () => {
    it('reassigning an orphan league writes a reassign audit row', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${leagueForReassign}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(200);

      const rows = await newAuditRows({ resourceType: 'leagues', resourceId: leagueForReassign });
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        adminUserId: admin.user.id,
        resourceType: 'leagues',
        resourceId: leagueForReassign,
        action: 'reassign',
        organizationId: targetOrgId,
      });
    });

    it('reassigning an orphan user writes a reassign audit row', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/users/${userForReassign}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(200);

      const rows = await newAuditRows({ resourceType: 'users', resourceId: userForReassign });
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        adminUserId: admin.user.id,
        resourceType: 'users',
        resourceId: userForReassign,
        action: 'reassign',
        organizationId: targetOrgId,
      });
    });

    it('deleting an orphan payment writes a delete audit row (organizationId null)', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/payments/${paymentForDelete}/delete`,
        {},
        admin,
      );
      expect(status).toBe(200);

      const rows = await newAuditRows({ resourceType: 'payments', resourceId: paymentForDelete });
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        adminUserId: admin.user.id,
        resourceType: 'payments',
        resourceId: paymentForDelete,
        action: 'delete',
        organizationId: null,
      });
      paymentForDelete = 0;
    });

    it('deleting an orphan bowler-league writes a delete audit row', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/bowlerLeagues/${bowlerLeagueForDelete}/delete`,
        {},
        admin,
      );
      expect(status).toBe(200);

      const rows = await newAuditRows({ resourceType: 'bowlerLeagues', resourceId: bowlerLeagueForDelete });
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        resourceType: 'bowlerLeagues',
        resourceId: bowlerLeagueForDelete,
        action: 'delete',
        organizationId: null,
      });
      bowlerLeagueForDelete = 0;
    });

    it('deleting an orphan team writes a delete audit row', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/teams/${teamForDelete}/delete`,
        {},
        admin,
      );
      expect(status).toBe(200);

      const rows = await newAuditRows({ resourceType: 'teams', resourceId: teamForDelete });
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        resourceType: 'teams',
        resourceId: teamForDelete,
        action: 'delete',
        organizationId: null,
      });
      teamForDelete = 0;
    });

    it('deleting an orphan league writes a delete audit row', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${leagueForDelete}/delete`,
        {},
        admin,
      );
      expect(status).toBe(200);

      const rows = await newAuditRows({ resourceType: 'leagues', resourceId: leagueForDelete });
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        resourceType: 'leagues',
        resourceId: leagueForDelete,
        action: 'delete',
        organizationId: null,
      });
      leagueForDelete = 0;
    });

    it('deleting an orphan user writes a delete audit row', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/users/${userForDelete}/delete`,
        {},
        admin,
      );
      expect(status).toBe(200);

      const rows = await newAuditRows({ resourceType: 'users', resourceId: userForDelete });
      expect(rows.length).toBe(1);
      expect(rows[0]).toMatchObject({
        resourceType: 'users',
        resourceId: userForDelete,
        action: 'delete',
        organizationId: null,
      });
      userForDelete = 0;
    });
  });

  // -------------------------------------------------------------------
  // GET /orphaned-data-audits — listing, admin gating, limit clamp
  // -------------------------------------------------------------------

  describe('GET /api/system-admin/orphaned-data-audits', () => {
    it('rejects non-system-admin sessions with 403', async () => {
      const { status } = await apiGet('/api/system-admin/orphaned-data-audits', orgAdmin);
      expect(status).toBe(403);
    });

    it('rejects unauthenticated callers with 401 or 403', async () => {
      const { status } = await apiGet('/api/system-admin/orphaned-data-audits');
      expect([401, 403]).toContain(status);
    });

    it('returns recent audit rows hydrated with admin and org info', async () => {
      const { status, data } = await apiGet<CleanupAuditRowDTO[]>(
        '/api/system-admin/orphaned-data-audits',
        admin,
      );
      expect(status).toBe(200);
      const rows = data.data ?? [];
      expect(rows.length).toBeGreaterThan(0);

      const reassignRow = rows.find(
        (r) => r.resourceType === 'leagues' && r.resourceId === leagueForReassign && r.action === 'reassign',
      );
      expect(reassignRow).toBeTruthy();
      expect(reassignRow!.adminUserId).toBe(admin.user.id);
      expect(reassignRow!.adminUserEmail?.toLowerCase()).toBe(admin.user.email.toLowerCase());
      expect(reassignRow!.organizationId).toBe(targetOrgId);
      expect(reassignRow!.organizationName).not.toBeNull();
    });

    it('orders results newest-first', async () => {
      const { data } = await apiGet<CleanupAuditRowDTO[]>(
        '/api/system-admin/orphaned-data-audits',
        admin,
      );
      const rows = data.data ?? [];
      // The endpoint orders by `createdAt DESC, id DESC`. With sibling
      // suites running in parallel, two inserts can land in the same
      // millisecond and the secondary id-tiebreaker takes over — so we
      // compare timestamps (primary) and fall back to id only when the
      // timestamps tie.
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const curr = rows[i];
        const prevTs = new Date(prev.createdAt as unknown as string).getTime();
        const currTs = new Date(curr.createdAt as unknown as string).getTime();
        expect(prevTs).toBeGreaterThanOrEqual(currTs);
        if (prevTs === currTs) {
          expect(prev.id).toBeGreaterThanOrEqual(curr.id);
        }
      }
    });

    it('honors the limit query parameter', async () => {
      const { status, data } = await apiGet<CleanupAuditRowDTO[]>(
        '/api/system-admin/orphaned-data-audits?limit=1',
        admin,
      );
      expect(status).toBe(200);
      expect((data.data ?? []).length).toBeLessThanOrEqual(1);
    });

    it('clamps limits above the upper bound (200)', async () => {
      const { status, data } = await apiGet<CleanupAuditRowDTO[]>(
        '/api/system-admin/orphaned-data-audits?limit=99999',
        admin,
      );
      expect(status).toBe(200);
      expect((data.data ?? []).length).toBeLessThanOrEqual(200);
    });

    it('falls back to the default limit when the parameter is non-numeric', async () => {
      const { status, data } = await apiGet<CleanupAuditRowDTO[]>(
        '/api/system-admin/orphaned-data-audits?limit=not-a-number',
        admin,
      );
      expect(status).toBe(200);
      expect((data.data ?? []).length).toBeLessThanOrEqual(50);
    });
  });
});
