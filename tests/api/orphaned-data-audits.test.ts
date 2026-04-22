import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, eq, and, gt, asc } from 'drizzle-orm';
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

  // High-water mark of the audit table at the start of every test, so we
  // can assert which audit rows (if any) were produced by the action
  // under test without depending on prior history.
  let auditWatermark = 0;

  async function refreshWatermark() {
    const [row] = await db
      .select({ value: sql<number>`coalesce(max(${orphanCleanupAudits.id}), 0)::int` })
      .from(orphanCleanupAudits);
    auditWatermark = Number(row?.value ?? 0);
  }

  async function newAuditRows() {
    return db
      .select()
      .from(orphanCleanupAudits)
      .where(gt(orphanCleanupAudits.id, auditWatermark))
      .orderBy(asc(orphanCleanupAudits.id));
  }

  beforeAll(async () => {
    admin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    orgAdmin = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);

    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .limit(1);
    if (!org) throw new Error('No organization available for audit tests');
    targetOrgId = org.id;

    // Mirror the orphaned-data.test.ts setup: relax constraints so we can
    // create org-less rows and child rows whose parent league is missing.
    await db.execute(sql`ALTER TABLE leagues ALTER COLUMN organization_id DROP NOT NULL`);
    await db.execute(sql`ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_league_id_leagues_id_fk`);
    await db.execute(sql`ALTER TABLE bowler_leagues DROP CONSTRAINT IF EXISTS bowler_leagues_league_id_leagues_id_fk`);
    await db.execute(sql`ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_league_id_leagues_id_fk`);

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

    const [bw] = await db
      .insert(bowlers)
      .values({ name: 'Vitest Audit Bowler' })
      .returning({ id: bowlers.id });
    bowlerId = bw.id;

    const [t1] = await db
      .insert(teams)
      .values({ name: 'Vitest Audit Orphan Team', number: 9981, leagueId: parentOrphanLeagueId })
      .returning({ id: teams.id });
    teamForDelete = t1.id;

    const [bl1] = await db
      .insert(bowlerLeagues)
      .values({ bowlerId, leagueId: parentOrphanLeagueId, teamId: teamForDelete })
      .returning({ id: bowlerLeagues.id });
    bowlerLeagueForDelete = bl1.id;

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

    const pwd = await hashPassword('Throwaway-Password-123!');
    const stamp = Date.now();

    const [u1] = await db
      .insert(users)
      .values({
        email: `vitest-audit-orphan-reassign-${stamp}@example.com`,
        password: pwd,
        name: 'Vitest Audit Orphan User (reassign)',
        role: 'user',
        organizationId: null,
      })
      .returning({ id: users.id });
    userForReassign = u1.id;

    const [u2] = await db
      .insert(users)
      .values({
        email: `vitest-audit-orphan-delete-${stamp}@example.com`,
        password: pwd,
        name: 'Vitest Audit Orphan User (delete)',
        role: 'user',
        organizationId: null,
      })
      .returning({ id: users.id });
    userForDelete = u2.id;

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
  });

  afterAll(async () => {
    const tryRun = async (fn: () => Promise<unknown>) => {
      try { await fn(); } catch { /* best effort */ }
    };

    // Clear any audit rows we created so the table doesn't grow forever
    // across repeated test runs against the same dev database.
    for (const id of [
      leagueForReassign, leagueForDelete, parentOrphanLeagueId, nonOrphanLeagueId,
    ]) {
      if (id) {
        await tryRun(() =>
          db.delete(orphanCleanupAudits).where(and(
            eq(orphanCleanupAudits.resourceType, 'leagues'),
            eq(orphanCleanupAudits.resourceId, id),
          )),
        );
      }
    }
    for (const [type, id] of [
      ['teams', teamForDelete],
      ['bowlerLeagues', bowlerLeagueForDelete],
      ['payments', paymentForDelete],
      ['users', userForReassign],
      ['users', userForDelete],
      ['users', nonOrphanUserId],
    ] as const) {
      if (id) {
        await tryRun(() =>
          db.delete(orphanCleanupAudits).where(and(
            eq(orphanCleanupAudits.resourceType, type),
            eq(orphanCleanupAudits.resourceId, id),
          )),
        );
      }
    }

    for (const id of [userForReassign, userForDelete, nonOrphanUserId]) {
      if (id) await tryRun(() => db.delete(users).where(eq(users.id, id)));
    }
    if (paymentForDelete) await tryRun(() => db.delete(payments).where(eq(payments.id, paymentForDelete)));
    if (bowlerLeagueForDelete) await tryRun(() => db.delete(bowlerLeagues).where(eq(bowlerLeagues.id, bowlerLeagueForDelete)));
    if (teamForDelete) await tryRun(() => db.delete(teams).where(eq(teams.id, teamForDelete)));
    if (bowlerId) await tryRun(() => db.delete(bowlers).where(eq(bowlers.id, bowlerId)));
    for (const id of [leagueForReassign, leagueForDelete, parentOrphanLeagueId, nonOrphanLeagueId]) {
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
      expect(await newAuditRows()).toEqual([]);
    });

    it('reassign of non-existent league (404) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${BOGUS_LEAGUE_ID}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(404);
      expect(await newAuditRows()).toEqual([]);
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
      expect(await newAuditRows()).toEqual([]);
    });

    it('reassign of a non-orphan user (409) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/users/${nonOrphanUserId}/reassign`,
        { organizationId: targetOrgId },
        admin,
      );
      expect(status).toBe(409);
      expect(await newAuditRows()).toEqual([]);
    });

    it('delete of non-existent league (404) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${BOGUS_LEAGUE_ID}/delete`,
        {},
        admin,
      );
      expect(status).toBe(404);
      expect(await newAuditRows()).toEqual([]);
    });

    it('delete of non-existent team (404) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/teams/${BOGUS_LEAGUE_ID}/delete`,
        {},
        admin,
      );
      expect(status).toBe(404);
      expect(await newAuditRows()).toEqual([]);
    });

    it('delete of a non-orphan league (409) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${nonOrphanLeagueId}/delete`,
        {},
        admin,
      );
      expect(status).toBe(409);
      expect(await newAuditRows()).toEqual([]);
    });

    it('delete of a non-orphan user (409) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/users/${nonOrphanUserId}/delete`,
        {},
        admin,
      );
      expect(status).toBe(409);
      expect(await newAuditRows()).toEqual([]);
    });

    it('unauthorized reassign (org admin, not system admin) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${leagueForReassign}/reassign`,
        { organizationId: targetOrgId },
        orgAdmin,
      );
      expect(status).toBe(403);
      expect(await newAuditRows()).toEqual([]);
    });

    it('unauthorized delete (org admin, not system admin) writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${leagueForDelete}/delete`,
        {},
        orgAdmin,
      );
      expect(status).toBe(403);
      expect(await newAuditRows()).toEqual([]);
    });

    it('unauthenticated reassign writes nothing', async () => {
      await refreshWatermark();
      const { status } = await apiPost(
        `/api/system-admin/orphaned-data/leagues/${leagueForReassign}/reassign`,
        { organizationId: targetOrgId },
      );
      expect([401, 403]).toContain(status);
      expect(await newAuditRows()).toEqual([]);
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

      const rows = await newAuditRows();
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

      const rows = await newAuditRows();
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

      const rows = await newAuditRows();
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

      const rows = await newAuditRows();
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

      const rows = await newAuditRows();
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

      const rows = await newAuditRows();
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

      const rows = await newAuditRows();
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
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i - 1].id).toBeGreaterThanOrEqual(rows[i].id);
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
