import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  leagues,
  teams,
  bowlers,
  bowlerLeagues,
  payments,
  users,
  organizations,
} from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import {
  login,
  apiGet,
  apiPost,
  type AuthSession,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
} from '../helpers';

interface OrphanedLeagueRow { id: number; name: string }
interface OrphanedTeamRow {
  id: number;
  leagueId: number;
  parentLeagueExists: boolean;
  leagueOrganizationId: number | null;
}
interface OrphanedChildRow {
  id: number;
  leagueId: number;
  parentLeagueExists: boolean;
}
interface OrphanedUserRow { id: number; email: string; role: string }

const BOGUS_LEAGUE_ID = 2_000_000_000;

describe('Orphaned Data API (system-admin)', () => {
  let admin: AuthSession;
  let targetOrgId: number;

  let orphanLeagueA = 0; // children attach here; deleted in delete-success test
  let orphanLeagueB = 0; // reassigned in reassign-success test
  let nonOrphanLeagueId = 0;

  let bowlerId = 0;
  let orphanTeamId = 0;
  let parentMissingTeamId = 0;
  let nonOrphanTeamId = 0;
  let orphanBowlerLeagueId = 0;
  let parentMissingBowlerLeagueId = 0;
  let orphanPaymentId = 0;
  let parentMissingPaymentId = 0;

  let orphanUserId = 0;
  let orphanSysAdminId = 0;
  let nonOrphanUserId = 0;

  beforeAll(async () => {
    admin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);

    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .limit(1);
    if (!org) throw new Error('No organization available for orphaned-data tests');
    targetOrgId = org.id;

    // Allow nullable organization_id and let us insert child rows pointing
    // at non-existent leagues so we can exercise both orphan variants.
    await db.execute(sql`ALTER TABLE leagues ALTER COLUMN organization_id DROP NOT NULL`);
    await db.execute(sql`ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_league_id_leagues_id_fk`);
    await db.execute(sql`ALTER TABLE bowler_leagues DROP CONSTRAINT IF EXISTS bowler_leagues_league_id_leagues_id_fk`);
    await db.execute(sql`ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_league_id_leagues_id_fk`);

    const leagueDefaults = {
      seasonStart: '2025-01-01 00:00:00',
      seasonEnd: '2025-12-31 00:00:00',
      weekDay: 'Monday' as const,
    };

    const [la] = await db
      .insert(leagues)
      .values({
        name: 'Vitest Orphan League A',
        ...leagueDefaults,
        organizationId: null as unknown as number,
      })
      .returning({ id: leagues.id });
    orphanLeagueA = la.id;

    const [lb] = await db
      .insert(leagues)
      .values({
        name: 'Vitest Orphan League B',
        ...leagueDefaults,
        organizationId: null as unknown as number,
      })
      .returning({ id: leagues.id });
    orphanLeagueB = lb.id;

    const [ln] = await db
      .insert(leagues)
      .values({
        name: 'Vitest Non-Orphan League',
        ...leagueDefaults,
        organizationId: targetOrgId,
      })
      .returning({ id: leagues.id });
    nonOrphanLeagueId = ln.id;

    const [bw] = await db
      .insert(bowlers)
      .values({ name: 'Vitest Orphan Bowler' })
      .returning({ id: bowlers.id });
    bowlerId = bw.id;

    // Teams: parent-org-null variant + parent-missing variant + non-orphan
    const [t1] = await db
      .insert(teams)
      .values({ name: 'Vitest Orphan Team', number: 9991, leagueId: orphanLeagueA })
      .returning({ id: teams.id });
    orphanTeamId = t1.id;

    const [t2] = await db
      .insert(teams)
      .values({ name: 'Vitest Parent-Missing Team', number: 9992, leagueId: BOGUS_LEAGUE_ID })
      .returning({ id: teams.id });
    parentMissingTeamId = t2.id;

    const [t3] = await db
      .insert(teams)
      .values({ name: 'Vitest Non-Orphan Team', number: 9993, leagueId: nonOrphanLeagueId })
      .returning({ id: teams.id });
    nonOrphanTeamId = t3.id;

    const [bl1] = await db
      .insert(bowlerLeagues)
      .values({ bowlerId, leagueId: orphanLeagueA, teamId: orphanTeamId })
      .returning({ id: bowlerLeagues.id });
    orphanBowlerLeagueId = bl1.id;

    const [bl2] = await db
      .insert(bowlerLeagues)
      .values({ bowlerId, leagueId: BOGUS_LEAGUE_ID, teamId: orphanTeamId })
      .returning({ id: bowlerLeagues.id });
    parentMissingBowlerLeagueId = bl2.id;

    const [p1] = await db
      .insert(payments)
      .values({
        bowlerId,
        leagueId: orphanLeagueA,
        amount: 100,
        weekOf: '2025-01-06 00:00:00',
        type: 'cash',
      })
      .returning({ id: payments.id });
    orphanPaymentId = p1.id;

    const [p2] = await db
      .insert(payments)
      .values({
        bowlerId,
        leagueId: BOGUS_LEAGUE_ID,
        amount: 100,
        weekOf: '2025-01-06 00:00:00',
        type: 'cash',
      })
      .returning({ id: payments.id });
    parentMissingPaymentId = p2.id;

    const pwd = await hashPassword('Throwaway-Password-123!');
    const stamp = Date.now();

    const [u1] = await db
      .insert(users)
      .values({
        email: `vitest-orphan-${stamp}@example.com`,
        password: pwd,
        name: 'Vitest Orphan User',
        role: 'user',
        organizationId: null,
      })
      .returning({ id: users.id });
    orphanUserId = u1.id;

    const [u2] = await db
      .insert(users)
      .values({
        email: `vitest-orphan-sysadmin-${stamp}@example.com`,
        password: pwd,
        name: 'Vitest Orphan SysAdmin',
        role: 'system_admin',
        organizationId: null,
      })
      .returning({ id: users.id });
    orphanSysAdminId = u2.id;

    const [u3] = await db
      .insert(users)
      .values({
        email: `vitest-nonorphan-${stamp}@example.com`,
        password: pwd,
        name: 'Vitest Non-Orphan User',
        role: 'user',
        organizationId: targetOrgId,
      })
      .returning({ id: users.id });
    nonOrphanUserId = u3.id;
  });

  afterAll(async () => {
    const tryRun = async (fn: () => Promise<unknown>) => {
      try { await fn(); } catch { /* best effort */ }
    };

    for (const id of [orphanUserId, orphanSysAdminId, nonOrphanUserId]) {
      if (id) await tryRun(() => db.delete(users).where(eq(users.id, id)));
    }
    for (const id of [orphanPaymentId, parentMissingPaymentId]) {
      if (id) await tryRun(() => db.delete(payments).where(eq(payments.id, id)));
    }
    for (const id of [orphanBowlerLeagueId, parentMissingBowlerLeagueId]) {
      if (id) await tryRun(() => db.delete(bowlerLeagues).where(eq(bowlerLeagues.id, id)));
    }
    for (const id of [orphanTeamId, parentMissingTeamId, nonOrphanTeamId]) {
      if (id) await tryRun(() => db.delete(teams).where(eq(teams.id, id)));
    }
    if (bowlerId) await tryRun(() => db.delete(bowlers).where(eq(bowlers.id, bowlerId)));
    for (const id of [orphanLeagueA, orphanLeagueB, nonOrphanLeagueId]) {
      if (id) await tryRun(() => db.delete(leagues).where(eq(leagues.id, id)));
    }

    await tryRun(() =>
      db.execute(
        sql`ALTER TABLE teams ADD CONSTRAINT teams_league_id_leagues_id_fk FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE`,
      ),
    );
    await tryRun(() =>
      db.execute(
        sql`ALTER TABLE bowler_leagues ADD CONSTRAINT bowler_leagues_league_id_leagues_id_fk FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE`,
      ),
    );
    await tryRun(() =>
      db.execute(
        sql`ALTER TABLE payments ADD CONSTRAINT payments_league_id_leagues_id_fk FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE`,
      ),
    );
    await tryRun(() =>
      db.execute(sql`ALTER TABLE leagues ALTER COLUMN organization_id SET NOT NULL`),
    );
  });

  // ---- list endpoints --------------------------------------------------

  describe('GET /orphaned-data/:type', () => {
    it('lists orphan leagues and excludes non-orphan leagues', async () => {
      const { status, data } = await apiGet<OrphanedLeagueRow[]>(
        '/api/system-admin/orphaned-data/leagues',
        admin,
      );
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      const ids = (data.data ?? []).map((r) => r.id);
      expect(ids).toContain(orphanLeagueA);
      expect(ids).toContain(orphanLeagueB);
      expect(ids).not.toContain(nonOrphanLeagueId);
    });

    it('lists orphan teams including both parent-org-null and parent-missing variants', async () => {
      const { status, data } = await apiGet<OrphanedTeamRow[]>(
        '/api/system-admin/orphaned-data/teams',
        admin,
      );
      expect(status).toBe(200);
      const rows = data.data ?? [];
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(orphanTeamId);
      expect(ids).toContain(parentMissingTeamId);
      expect(ids).not.toContain(nonOrphanTeamId);

      const orphanRow = rows.find((r) => r.id === orphanTeamId)!;
      expect(orphanRow.parentLeagueExists).toBe(true);
      expect(orphanRow.leagueOrganizationId).toBeNull();

      const missingRow = rows.find((r) => r.id === parentMissingTeamId)!;
      expect(missingRow.parentLeagueExists).toBe(false);
    });

    it('lists orphan bowler-leagues including both variants', async () => {
      const { data } = await apiGet<OrphanedChildRow[]>(
        '/api/system-admin/orphaned-data/bowlerLeagues',
        admin,
      );
      const rows = data.data ?? [];
      const orphan = rows.find((r) => r.id === orphanBowlerLeagueId);
      const missing = rows.find((r) => r.id === parentMissingBowlerLeagueId);
      expect(orphan).toBeTruthy();
      expect(orphan!.parentLeagueExists).toBe(true);
      expect(missing).toBeTruthy();
      expect(missing!.parentLeagueExists).toBe(false);
    });

    it('lists orphan payments including both variants', async () => {
      const { data } = await apiGet<OrphanedChildRow[]>(
        '/api/system-admin/orphaned-data/payments',
        admin,
      );
      const rows = data.data ?? [];
      const orphan = rows.find((r) => r.id === orphanPaymentId);
      const missing = rows.find((r) => r.id === parentMissingPaymentId);
      expect(orphan).toBeTruthy();
      expect(orphan!.parentLeagueExists).toBe(true);
      expect(missing).toBeTruthy();
      expect(missing!.parentLeagueExists).toBe(false);
    });

    it('lists orphan users but excludes system_admin and non-orphan users', async () => {
      const { data } = await apiGet<OrphanedUserRow[]>(
        '/api/system-admin/orphaned-data/users',
        admin,
      );
      const ids = (data.data ?? []).map((r) => r.id);
      expect(ids).toContain(orphanUserId);
      expect(ids).not.toContain(orphanSysAdminId);
      expect(ids).not.toContain(nonOrphanUserId);
    });

    it('rejects unknown resource types with 400', async () => {
      const { status } = await apiGet(
        '/api/system-admin/orphaned-data/widgets',
        admin,
      );
      expect(status).toBe(400);
    });
  });

  // ---- repair: 400 / 404 / 409 paths -----------------------------------

  describe('POST /orphaned-data/:type/:id/reassign', () => {
    it('refuses to reassign child resource types (teams) with 400', async () => {
      const { status, data } = await apiPost(
        `/api/system-admin/orphaned-data/teams/${orphanTeamId}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(400);
      expect(data.error?.code).toBe('REASSIGN_UNSUPPORTED');
    });

    it('refuses to reassign bowlerLeagues with 400', async () => {
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/bowlerLeagues/${orphanBowlerLeagueId}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(400);
    });

    it('refuses to reassign payments with 400', async () => {
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/payments/${orphanPaymentId}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(400);
    });

    it('returns 404 when the league row does not exist', async () => {
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/999999999/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(404);
    });

    it('returns 404 when the user row does not exist', async () => {
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/users/999999999/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(404);
    });

    it('returns 409 when the league exists but is not orphaned', async () => {
      const { status, data } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${nonOrphanLeagueId}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(409);
      expect(data.error?.code).toBe('NOT_ORPHANED');
    });

    it('returns 409 when the user exists but is not orphaned', async () => {
      const { status, data } = await apiPost(
        `/api/system-admin/orphaned-data/users/${nonOrphanUserId}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(409);
      expect(data.error?.code).toBe('NOT_ORPHANED');
    });

    it('refuses to reassign system_admin users (returns 409, not_orphaned)', async () => {
      const { status, data } = await apiPost(
        `/api/system-admin/orphaned-data/users/${orphanSysAdminId}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(409);
      expect(data.error?.code).toBe('NOT_ORPHANED');

      const [row] = await db
        .select({ organizationId: users.organizationId, role: users.role })
        .from(users)
        .where(eq(users.id, orphanSysAdminId));
      expect(row.organizationId).toBeNull();
      expect(row.role).toBe('system_admin');
    });
  });

  describe('POST /orphaned-data/:type/:id/delete', () => {
    it('returns 404 when the league row does not exist', async () => {
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/999999999/delete`,
        {},
        admin,
      );
      expect(status).toBe(404);
    });

    it('returns 404 when the team row does not exist', async () => {
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/teams/999999999/delete`,
        {},
        admin,
      );
      expect(status).toBe(404);
    });

    it('returns 409 when the league exists but is not orphaned', async () => {
      const { status, data } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${nonOrphanLeagueId}/delete`,
        {},
        admin,
      );
      expect(status).toBe(409);
      expect(data.error?.code).toBe('NOT_ORPHANED');
    });

    it('returns 409 when the team exists but is not orphaned', async () => {
      const { status, data } = await apiPost(
        `/api/system-admin/orphaned-data/teams/${nonOrphanTeamId}/delete`,
        {},
        admin,
      );
      expect(status).toBe(409);
      expect(data.error?.code).toBe('NOT_ORPHANED');
    });

    it('returns 409 when the user exists but is not orphaned', async () => {
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/users/${nonOrphanUserId}/delete`,
        {},
        admin,
      );
      expect(status).toBe(409);
    });

    it('refuses to delete system_admin users (returns 409, not_orphaned)', async () => {
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/users/${orphanSysAdminId}/delete`,
        {},
        admin,
      );
      expect(status).toBe(409);

      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, orphanSysAdminId));
      expect(row).toBeTruthy();
    });
  });

  // ---- success paths ---------------------------------------------------

  describe('repair success paths', () => {
    it('deletes orphan child rows (team / bowler-league / payment / parent-missing variants)', async () => {
      for (const [type, id] of [
        ['payments', orphanPaymentId],
        ['payments', parentMissingPaymentId],
        ['bowlerLeagues', orphanBowlerLeagueId],
        ['bowlerLeagues', parentMissingBowlerLeagueId],
        ['teams', orphanTeamId],
        ['teams', parentMissingTeamId],
      ] as const) {
        const { status } = await apiPost(
          `/api/system-admin/orphaned-data/${type}/${id}/delete`,
          {},
          admin,
        );
        expect(status, `delete ${type}/${id}`).toBe(200);
      }

      // Mark cleaned up so afterAll doesn't try again
      orphanPaymentId = 0;
      parentMissingPaymentId = 0;
      orphanBowlerLeagueId = 0;
      parentMissingBowlerLeagueId = 0;
      orphanTeamId = 0;
      parentMissingTeamId = 0;
    });

    it('deletes the now-empty orphan league A', async () => {
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${orphanLeagueA}/delete`,
        {},
        admin,
      );
      expect(status).toBe(200);

      const remaining = await db
        .select({ id: leagues.id })
        .from(leagues)
        .where(eq(leagues.id, orphanLeagueA));
      expect(remaining.length).toBe(0);
      orphanLeagueA = 0;
    });

    it('reassigns orphan league B to a real organization', async () => {
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${orphanLeagueB}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(200);

      const [row] = await db
        .select({ organizationId: leagues.organizationId })
        .from(leagues)
        .where(eq(leagues.id, orphanLeagueB));
      expect(row.organizationId).toBe(targetOrgId);
    });

    it('undoes the league reassign and writes a follow-up audit row', async () => {
      // Pull the most recent audit row for this league reassign so we can hit
      // the undo endpoint by audit id.
      interface AuditRow {
        id: number;
        action: string;
        resourceType: string;
        resourceId: number;
        organizationId: number | null;
        previousOrganizationId: number | null;
        undoneAt: string | null;
        undoneByAuditId: number | null;
      }
      const { data: listed } = await apiGet<AuditRow[]>(
        '/api/system-admin/orphaned-data-audits?limit=200',
        admin,
      );
      const reassignAudit = (listed.data ?? []).find(
        (r) => r.action === 'reassign' && r.resourceType === 'leagues' && r.resourceId === orphanLeagueB,
      );
      expect(reassignAudit, 'reassign audit row should exist').toBeTruthy();
      expect(reassignAudit!.previousOrganizationId).toBeNull();
      expect(reassignAudit!.organizationId).toBe(targetOrgId);
      expect(reassignAudit!.undoneAt).toBeNull();

      const { status } = await apiPost(
        `/api/system-admin/orphaned-data-audits/${reassignAudit!.id}/undo`,
        {},
        admin,
      );
      expect(status).toBe(200);

      // The league should be back to org-less.
      const [restored] = await db
        .select({ organizationId: leagues.organizationId })
        .from(leagues)
        .where(eq(leagues.id, orphanLeagueB));
      expect(restored.organizationId).toBeNull();

      // Activity log: original audit is now marked undone, and a new
      // undo_reassign row was written for traceability.
      const { data: after } = await apiGet<AuditRow[]>(
        '/api/system-admin/orphaned-data-audits?limit=200',
        admin,
      );
      const original = (after.data ?? []).find((r) => r.id === reassignAudit!.id);
      expect(original!.undoneAt).not.toBeNull();
      expect(original!.undoneByAuditId).not.toBeNull();
      const undoRow = (after.data ?? []).find(
        (r) => r.action === 'undo_reassign' && r.resourceType === 'leagues' && r.resourceId === orphanLeagueB,
      );
      expect(undoRow, 'undo audit row should exist').toBeTruthy();
      expect(undoRow!.previousOrganizationId).toBe(targetOrgId);
      expect(undoRow!.organizationId).toBeNull();

      // Re-trying the same undo should fail with 409 ALREADY_UNDONE.
      const { status: again, data: againData } = await apiPost(
        `/api/system-admin/orphaned-data-audits/${reassignAudit!.id}/undo`,
        {},
        admin,
      );
      expect(again).toBe(409);
      expect(againData.error?.code).toBe('ALREADY_UNDONE');
    });

    it('reassigns the orphan user to a real organization', async () => {
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/users/${orphanUserId}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(200);

      const [row] = await db
        .select({ organizationId: users.organizationId })
        .from(users)
        .where(eq(users.id, orphanUserId));
      expect(row.organizationId).toBe(targetOrgId);
    });

    it('refuses to undo a delete audit row (snapshot path is the recovery option)', async () => {
      // The earlier delete-success test deleted orphanLeagueA. Find that
      // audit row and confirm undo is rejected with UNDO_UNSUPPORTED, while
      // the snapshot was captured.
      interface AuditRow {
        id: number;
        action: string;
        resourceType: string;
        resourceId: number;
        snapshot: unknown;
      }
      const { data } = await apiGet<AuditRow[]>(
        '/api/system-admin/orphaned-data-audits?limit=200',
        admin,
      );
      const deleteAudit = (data.data ?? []).find(
        (r) => r.action === 'delete' && r.resourceType === 'leagues',
      );
      expect(deleteAudit, 'delete audit row should exist').toBeTruthy();
      expect(deleteAudit!.snapshot).toBeTruthy();
      expect((deleteAudit!.snapshot as { id: number }).id).toBeGreaterThan(0);

      const { status, data: errData } = await apiPost(
        `/api/system-admin/orphaned-data-audits/${deleteAudit!.id}/undo`,
        {},
        admin,
      );
      expect(status).toBe(400);
      expect(errData.error?.code).toBe('UNDO_UNSUPPORTED');
    });

    it('returns 404 when undoing a non-existent audit row', async () => {
      const { status } = await apiPost(
        '/api/system-admin/orphaned-data-audits/999999999/undo',
        {},
        admin,
      );
      expect(status).toBe(404);
    });

    it('deletes the orphan system_admin user (after we strip the role) to confirm delete success path', async () => {
      // Strip the system_admin role so the delete repair endpoint will accept it.
      await db
        .update(users)
        .set({ role: 'user' })
        .where(eq(users.id, orphanSysAdminId));

      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/users/${orphanSysAdminId}/delete`,
        {},
        admin,
      );
      expect(status).toBe(200);

      const remaining = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, orphanSysAdminId));
      expect(remaining.length).toBe(0);
      orphanSysAdminId = 0;
    });
  });
});
