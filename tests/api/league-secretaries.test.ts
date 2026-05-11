/**
 * Task #735 — League Secretary grant/revoke + access-control isolation.
 *
 * Pins the security contract for the new per-league admin role:
 *   - org_admin of the league's org may grant + revoke
 *   - system_admin is REJECTED with 403 SYSTEM_ADMIN_DENIED
 *   - cross-org grant target is rejected with 422 USER_NOT_IN_ORG
 *   - already-admin target is rejected with 422 USER_ALREADY_ADMIN
 *   - duplicate grant is idempotent (no audit double-write)
 *   - revoke is idempotent-ish (404 when not present)
 *   - org A's org_admin cannot grant/revoke against org B's league
 *   - listing is visible to same-org admins and to current secretaries
 *   - a granted secretary user can read /api/me/league-secretary-leagues
 *     and only sees the leagues they were granted on
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  users,
  leagues as leaguesTable,
  leagueSecretaries,
  leagueSecretaryAudits,
} from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import {
  login,
  apiGet,
  apiPost,
  apiDelete,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_B_EMAIL,
  TEST_ORG_PASSWORD,
  type AuthSession,
} from '../helpers';

interface LeagueLite {
  id: number;
  organizationId: number | null;
}

interface SecretaryRow {
  id: number;
  userId: number;
  leagueId: number;
  organizationId: number;
}

const stamp = Date.now();

describe('League Secretary grants (Task #735)', () => {
  let sysAdmin: AuthSession;
  let orgAAdmin: AuthSession;
  let orgBAdmin: AuthSession;
  let orgAId: number;
  let orgBId: number;
  let orgALeagueId: number;
  let orgBLeagueId: number;

  // Test users we provision directly via storage.
  let orgAUserPlainId = 0;
  let orgAUserOtherId = 0;
  let orgBUserPlainId = 0;
  let orgAOtherAdminId = 0;
  const createdUserIds: number[] = [];

  beforeAll(async () => {
    sysAdmin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    orgAAdmin = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    orgBAdmin = await login(TEST_ORG_B_EMAIL, TEST_ORG_PASSWORD);
    if (
      orgAAdmin.user.organizationId == null ||
      orgBAdmin.user.organizationId == null
    ) {
      throw new Error('Test fixture admins are missing organizationId');
    }
    orgAId = orgAAdmin.user.organizationId;
    orgBId = orgBAdmin.user.organizationId;

    const leaguesA = await apiGet<LeagueLite[]>('/api/leagues', orgAAdmin);
    const dataA = Array.isArray(leaguesA.data.data) ? leaguesA.data.data : [];
    expect(dataA.length).toBeGreaterThan(0);
    orgALeagueId = dataA[0].id;

    const leaguesB = await apiGet<LeagueLite[]>('/api/leagues', orgBAdmin);
    const dataB = Array.isArray(leaguesB.data.data) ? leaguesB.data.data : [];
    expect(dataB.length).toBeGreaterThan(0);
    orgBLeagueId = dataB[0].id;

    const password = await hashPassword('test-password-123!');
    const [u1] = await db
      .insert(users)
      .values({
        name: `Vitest Sec A1 ${stamp}`,
        email: `vitest-sec-a1-${stamp}@example.com`,
        password,
        role: 'user',
        organizationId: orgAId,
        bowlerId: null,
      })
      .returning();
    orgAUserPlainId = u1.id;
    createdUserIds.push(u1.id);

    const [u2] = await db
      .insert(users)
      .values({
        name: `Vitest Sec A2 ${stamp}`,
        email: `vitest-sec-a2-${stamp}@example.com`,
        password,
        role: 'user',
        organizationId: orgAId,
        bowlerId: null,
      })
      .returning();
    orgAUserOtherId = u2.id;
    createdUserIds.push(u2.id);

    const [u3] = await db
      .insert(users)
      .values({
        name: `Vitest Sec B1 ${stamp}`,
        email: `vitest-sec-b1-${stamp}@example.com`,
        password,
        role: 'user',
        organizationId: orgBId,
        bowlerId: null,
      })
      .returning();
    orgBUserPlainId = u3.id;
    createdUserIds.push(u3.id);

    const [u4] = await db
      .insert(users)
      .values({
        name: `Vitest Sec OrgAdmin ${stamp}`,
        email: `vitest-sec-orgadmin-${stamp}@example.com`,
        password,
        role: 'org_admin',
        organizationId: orgAId,
        bowlerId: null,
      })
      .returning();
    orgAOtherAdminId = u4.id;
    createdUserIds.push(u4.id);
  });

  afterAll(async () => {
    if (createdUserIds.length === 0) return;
    await db
      .delete(leagueSecretaryAudits)
      .where(inArray(leagueSecretaryAudits.targetUserId, createdUserIds));
    await db
      .delete(leagueSecretaries)
      .where(inArray(leagueSecretaries.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  });

  describe('POST grant', () => {
    it('org_admin in same org may grant a plain user', async () => {
      const res = await apiPost<SecretaryRow>(
        `/api/leagues/${orgALeagueId}/secretaries`,
        { userId: orgAUserPlainId },
        orgAAdmin,
      );
      expect(res.status).toBe(201);
      expect(res.data.data?.userId).toBe(orgAUserPlainId);
      expect(res.data.data?.leagueId).toBe(orgALeagueId);
      expect(res.data.data?.organizationId).toBe(orgAId);

      const audit = await db
        .select()
        .from(leagueSecretaryAudits)
        .where(eq(leagueSecretaryAudits.targetUserId, orgAUserPlainId));
      expect(audit.length).toBe(1);
      expect(audit[0].action).toBe('grant');
    });

    it('duplicate grant is idempotent: returns 200, does not double-audit', async () => {
      const res = await apiPost<SecretaryRow>(
        `/api/leagues/${orgALeagueId}/secretaries`,
        { userId: orgAUserPlainId },
        orgAAdmin,
      );
      expect(res.status).toBe(200);
      const audit = await db
        .select()
        .from(leagueSecretaryAudits)
        .where(eq(leagueSecretaryAudits.targetUserId, orgAUserPlainId));
      expect(audit.length).toBe(1);
    });

    it('system_admin is REJECTED with 403 SYSTEM_ADMIN_DENIED', async () => {
      const res = await apiPost(
        `/api/leagues/${orgALeagueId}/secretaries`,
        { userId: orgAUserOtherId },
        sysAdmin,
      );
      expect(res.status).toBe(403);
      expect(res.data.error?.code).toBe('SYSTEM_ADMIN_DENIED');
    });

    it('cross-org org_admin (org B trying to grant on org A league) is forbidden', async () => {
      const res = await apiPost(
        `/api/leagues/${orgALeagueId}/secretaries`,
        { userId: orgBUserPlainId },
        orgBAdmin,
      );
      expect(res.status).toBe(403);
    });

    it('rejects target user from a different org with USER_NOT_IN_ORG', async () => {
      const res = await apiPost(
        `/api/leagues/${orgALeagueId}/secretaries`,
        { userId: orgBUserPlainId },
        orgAAdmin,
      );
      expect(res.status).toBe(422);
      expect(res.data.error?.code).toBe('USER_NOT_IN_ORG');
    });

    it('rejects already-admin target with USER_ALREADY_ADMIN', async () => {
      const res = await apiPost(
        `/api/leagues/${orgALeagueId}/secretaries`,
        { userId: orgAOtherAdminId },
        orgAAdmin,
      );
      expect(res.status).toBe(422);
      expect(res.data.error?.code).toBe('USER_ALREADY_ADMIN');
    });
  });

  describe('GET list', () => {
    it('same-org org_admin sees the granted user', async () => {
      const res = await apiGet<SecretaryRow[]>(
        `/api/leagues/${orgALeagueId}/secretaries`,
        orgAAdmin,
      );
      expect(res.status).toBe(200);
      const rows = Array.isArray(res.data.data) ? res.data.data : [];
      expect(rows.some((r) => r.userId === orgAUserPlainId)).toBe(true);
    });

    it('cross-org admin gets 403 listing the other org\'s league secretaries', async () => {
      const res = await apiGet(
        `/api/leagues/${orgALeagueId}/secretaries`,
        orgBAdmin,
      );
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/me/league-secretary-leagues', () => {
    it('newly granted secretary sees their league in My Leagues', async () => {
      const session = await login(
        `vitest-sec-a1-${stamp}@example.com`,
        'test-password-123!',
      );
      const res = await apiGet<LeagueLite[]>(
        '/api/me/league-secretary-leagues',
        session,
      );
      expect(res.status).toBe(200);
      const ids = Array.isArray(res.data.data) ? res.data.data.map((l) => l.id) : [];
      expect(ids).toContain(orgALeagueId);
    });
  });

  describe('DELETE revoke', () => {
    it('system_admin is REJECTED with 403 SYSTEM_ADMIN_DENIED', async () => {
      const res = await apiDelete(
        `/api/leagues/${orgALeagueId}/secretaries/${orgAUserPlainId}`,
        sysAdmin,
      );
      expect(res.status).toBe(403);
      expect(res.data.error?.code).toBe('SYSTEM_ADMIN_DENIED');
    });

    it('cross-org org_admin cannot revoke', async () => {
      const res = await apiDelete(
        `/api/leagues/${orgALeagueId}/secretaries/${orgAUserPlainId}`,
        orgBAdmin,
      );
      expect(res.status).toBe(403);
    });

    it('same-org org_admin can revoke and writes a revoke audit', async () => {
      const res = await apiDelete(
        `/api/leagues/${orgALeagueId}/secretaries/${orgAUserPlainId}`,
        orgAAdmin,
      );
      expect(res.status).toBe(200);
      const audit = await db
        .select()
        .from(leagueSecretaryAudits)
        .where(eq(leagueSecretaryAudits.targetUserId, orgAUserPlainId));
      expect(audit.some((a) => a.action === 'revoke')).toBe(true);
    });

    it('revoke of non-existent grant returns 404', async () => {
      const res = await apiDelete(
        `/api/leagues/${orgALeagueId}/secretaries/${orgAUserPlainId}`,
        orgAAdmin,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('Secretary-aware route migration (Task #735 follow-up)', () => {
    let secretarySession: AuthSession;

    beforeAll(async () => {
      // Re-grant orgAUserPlainId on orgALeagueId (the earlier revoke
      // test removed the grant).
      await apiPost(
        `/api/leagues/${orgALeagueId}/secretaries`,
        { userId: orgAUserPlainId },
        orgAAdmin,
      );
      secretarySession = await login(
        `vitest-sec-a1-${stamp}@example.com`,
        'test-password-123!',
      );
    });

    it('secretary may list teams for their granted league', async () => {
      const res = await apiGet(
        `/api/teams?leagueId=${orgALeagueId}`,
        secretarySession,
      );
      expect(res.status).toBe(200);
    });

    it('secretary cannot list teams for a different league in the same org', async () => {
      // find a different league in org A; if only one exists, skip
      const all = await apiGet<LeagueLite[]>('/api/leagues', orgAAdmin);
      const others = (Array.isArray(all.data.data) ? all.data.data : [])
        .filter((l) => l.id !== orgALeagueId);
      if (others.length === 0) return;
      const otherLeagueId = others[0].id;
      const res = await apiGet(
        `/api/teams?leagueId=${otherLeagueId}`,
        secretarySession,
      );
      expect(res.status).toBe(403);
    });

    it('secretary cannot list teams across the org without a leagueId filter', async () => {
      const res = await apiGet<unknown[]>('/api/teams', secretarySession);
      expect(res.status).toBe(200);
      const teams = Array.isArray(res.data.data) ? res.data.data : [];
      // Whatever they see must be inside their granted leagueIds only.
      const granted = await apiGet<LeagueLite[]>(
        '/api/me/league-secretary-leagues',
        secretarySession,
      );
      const grantedIds = new Set(
        (Array.isArray(granted.data.data) ? granted.data.data : []).map((l) => l.id),
      );
      for (const t of teams as Array<{ leagueId: number }>) {
        expect(grantedIds.has(t.leagueId)).toBe(true);
      }
    });

    it('secretary cannot list payments for a league they were not granted on', async () => {
      const all = await apiGet<LeagueLite[]>('/api/leagues', orgAAdmin);
      const others = (Array.isArray(all.data.data) ? all.data.data : [])
        .filter((l) => l.id !== orgALeagueId);
      if (others.length === 0) return;
      const otherLeagueId = others[0].id;
      const res = await apiGet(
        `/api/payments?leagueId=${otherLeagueId}`,
        secretarySession,
      );
      expect(res.status).toBe(403);
    });

    it('secretary may list payments for their granted league', async () => {
      const res = await apiGet(
        `/api/payments?leagueId=${orgALeagueId}`,
        secretarySession,
      );
      expect(res.status).toBe(200);
    });

    it('secretary listing /api/payments (no leagueId) is SQL-scoped to granted leagues only', async () => {
      const res = await apiGet<Array<{ leagueId: number }>>(
        '/api/payments',
        secretarySession,
      );
      expect(res.status).toBe(200);
      const granted = await apiGet<LeagueLite[]>(
        '/api/me/league-secretary-leagues',
        secretarySession,
      );
      const grantedIds = new Set(
        (Array.isArray(granted.data.data) ? granted.data.data : []).map((l) => l.id),
      );
      const rows = Array.isArray(res.data.data) ? res.data.data : [];
      for (const p of rows) {
        expect(grantedIds.has(p.leagueId)).toBe(true);
      }
    });
  });

  describe('DB invariant', () => {
    it('rejects an insert whose organization_id does not match the league', async () => {
      // Direct DB insert bypassing the route layer — should be blocked by
      // the BEFORE INSERT trigger in server/db-invariants.ts.
      let threw = false;
      try {
        await db.insert(leagueSecretaries).values({
          userId: orgAUserOtherId,
          leagueId: orgALeagueId,
          // Wrong org id (org B's id, while the league is in org A)
          organizationId: orgBId,
          grantedByUserId: orgAAdmin.user.id,
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });
});
