import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../server/db';
import { bowlerLeagues, bowlers as bowlersTable, teams as teamsTable } from '@shared/schema';
import {
  login,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  type AuthSession,
  TEST_ORG_A_EMAIL,
  TEST_ORG_B_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

interface OrgUser {
  id: number;
  email: string;
  organizationId: number | null;
}

interface League {
  id: number;
  name: string;
  organizationId: number | null;
}

function hasStringEmail(value: unknown): value is { email: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { email?: unknown }).email === 'string'
  );
}

function hasNumericId(value: unknown): value is { id: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'number'
  );
}

function collectEmails(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data.filter(hasStringEmail).map((u) => u.email.toLowerCase());
}

function collectIds(data: unknown): number[] {
  if (!Array.isArray(data)) return [];
  return data.filter(hasNumericId).map((u) => u.id);
}

describe('Organization Isolation', () => {
  let sessionA: AuthSession;
  let sessionB: AuthSession;
  let orgBLeagueId: number | null = null;

  beforeAll(async () => {
    sessionA = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    sessionB = await login(TEST_ORG_B_EMAIL, TEST_ORG_PASSWORD);

    // Make sure org B owns at least one league so we can test cross-org
    // fetch-by-id as org A. Reuse the first existing league when present.
    const existing = await apiGet<League[]>('/api/leagues', sessionB);
    if (existing.status === 200 && Array.isArray(existing.data.data) && existing.data.data.length > 0) {
      orgBLeagueId = existing.data.data[0].id;
    } else {
      const created = await apiPost<League>(
        '/api/leagues',
        {
          name: 'Vitest Org B Isolation League',
          seasonStart: new Date().toISOString(),
          seasonEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          weekDay: 'Monday',
          weeklyFee: 2000,
        },
        sessionB,
      );
      const createdLeague = created.data.data;
      if (created.status === 201 && hasNumericId(createdLeague)) {
        orgBLeagueId = createdLeague.id;
      }
    }
  });

  describe('organization visibility', () => {
    it('org A admin should NOT be able to list all organizations (admin-only)', async () => {
      const { status } = await apiGet<OrgUser[]>('/api/organizations', sessionA);
      expect(status).toBe(403);
    });

    it('org B admin should NOT be able to list all organizations (admin-only)', async () => {
      const { status } = await apiGet<OrgUser[]>('/api/organizations', sessionB);
      expect(status).toBe(403);
    });
  });

  describe('user isolation', () => {
    it('org A admin should see own organization users', async () => {
      expect(sessionA.user.organizationId).toBeTruthy();
      const { status, data } = await apiGet<OrgUser[]>(
        `/api/org-admin/users?organizationId=${sessionA.user.organizationId}`,
        sessionA,
      );
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('org A admin should NOT see org B users (server scopes to caller org)', async () => {
      expect(sessionB.user.organizationId).toBeTruthy();
      const { status, data } = await apiGet<OrgUser[]>(
        `/api/org-admin/users?organizationId=${sessionB.user.organizationId}`,
        sessionA,
      );
      // The endpoint either denies the cross-org request outright, or
      // (more commonly) silently ignores the org id and returns the
      // caller's own users. Either way, no org B user must be returned.
      expect([200, 403]).toContain(status);
      if (status === 200 && Array.isArray(data.data)) {
        const emails = collectEmails(data.data);
        const ids = collectIds(data.data);
        // Strong leak check: org B's known admin must never appear in a
        // list returned to org A, by either email or user id.
        expect(emails).not.toContain(TEST_ORG_B_EMAIL.toLowerCase());
        expect(ids).not.toContain(sessionB.user.id);
        // And every returned user must be scoped to org A.
        for (const u of data.data) {
          expect(u.organizationId).toBe(sessionA.user.organizationId);
        }
      }
    });

    it('org B admin should NOT see org A users (server scopes to caller org)', async () => {
      expect(sessionA.user.organizationId).toBeTruthy();
      const { status, data } = await apiGet<OrgUser[]>(
        `/api/org-admin/users?organizationId=${sessionA.user.organizationId}`,
        sessionB,
      );
      expect([200, 403]).toContain(status);
      if (status === 200 && Array.isArray(data.data)) {
        const emails = collectEmails(data.data);
        const ids = collectIds(data.data);
        expect(emails).not.toContain(TEST_ORG_A_EMAIL.toLowerCase());
        expect(ids).not.toContain(sessionA.user.id);
        for (const u of data.data) {
          expect(u.organizationId).toBe(sessionB.user.organizationId);
        }
      }
    });
  });

  describe('league isolation', () => {
    it('org A admin should see their leagues', async () => {
      const { status, data } = await apiGet<League[]>('/api/leagues', sessionA);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      // No league belonging to org B may show up in org A's list.
      if (Array.isArray(data.data)) {
        for (const l of data.data) {
          expect(l.organizationId).toBe(sessionA.user.organizationId);
        }
        if (orgBLeagueId != null) {
          const ids = collectIds(data.data);
          expect(ids).not.toContain(orgBLeagueId);
        }
      }
    });

    it('org B admin should see their leagues', async () => {
      const { status, data } = await apiGet<League[]>('/api/leagues', sessionB);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      if (Array.isArray(data.data)) {
        for (const l of data.data) {
          expect(l.organizationId).toBe(sessionB.user.organizationId);
        }
      }
    });

    it('org B admin should NOT access org A leagues via org endpoint', async () => {
      expect(sessionA.user.organizationId).toBeTruthy();
      const { status } = await apiGet<League[]>(
        `/api/organizations/${sessionA.user.organizationId}/leagues`,
        sessionB,
      );
      expect(status).toBe(403);
    });

    it('org A admin fetching a known org B league by id must get a definitive 403/404', async () => {
      // Skip if we couldn't get/create an org B league (shouldn't happen in
      // normal CI, but bail out clearly rather than silently passing).
      expect(orgBLeagueId, 'expected an org B league id to test against').not.toBeNull();
      const { status, data } = await apiGet<League>(
        `/api/leagues/${orgBLeagueId}`,
        sessionA,
      );
      expect([403, 404]).toContain(status);
      expect(data.success).toBe(false);
      // Even error payloads must not leak the league's org id back to the caller.
      const payload = JSON.stringify(data);
      expect(payload).not.toContain(`"organizationId":${sessionB.user.organizationId}`);
    });
  });

  // -------------------------------------------------------------------------
  // Team and bowler cross-org isolation (task #310).
  //
  // PATCH/DELETE on /api/teams/:id and /api/bowlers/:id, plus GET on the same
  // ids and on the listing endpoints, must never leak or mutate org B data
  // when called from session A. These mirror the league-isolation cases above.
  // -------------------------------------------------------------------------
  describe('team and bowler isolation (task #310)', () => {
    interface Team {
      id: number;
      leagueId: number;
      name: string;
    }
    interface Bowler {
      id: number;
      name: string;
      email?: string | null;
    }
    interface BowlerLeague {
      id: number;
      bowlerId: number;
      leagueId: number;
      teamId: number;
    }

    let orgBTeamId: number | null = null;
    let orgBBowlerId: number | null = null;
    let bowlerLeagueId: number | null = null;
    const stamp = Date.now();
    // Unique team number per run to avoid colliding with the league's
    // teams_league_number_idx unique index across re-runs of the suite.
    const uniqueTeamNumber = (stamp % 90000) + 10000;

    beforeAll(async () => {
      // Need an org B league we already have; bail loudly if not.
      expect(orgBLeagueId, 'org B league fixture is required').not.toBeNull();

      // Create the org B team via API (exercises the real /api/teams POST
      // org-access check as session B).
      const teamRes = await apiPost<Team>(
        '/api/teams',
        { name: `Vitest Iso Team ${stamp}`, number: uniqueTeamNumber, leagueId: orgBLeagueId, active: true },
        sessionB,
      );
      const teamPayload = teamRes.data.data;
      if (teamRes.status === 201 && hasNumericId(teamPayload)) {
        orgBTeamId = teamPayload.id;
      }

      // Create the org B bowler via API.
      const bowlerRes = await apiPost<Bowler>(
        '/api/bowlers',
        { name: `Vitest Iso Bowler ${stamp}`, email: `vitest-iso-${stamp}@example.com`, active: true },
        sessionB,
      );
      const bowlerPayload = bowlerRes.data.data;
      if (bowlerRes.status === 201 && hasNumericId(bowlerPayload)) {
        orgBBowlerId = bowlerPayload.id;
      }

      // Link bowler → team → league directly via the DB. The /api/bowler-leagues
      // POST refuses to operate on a bowler with no existing league entries
      // (bootstrap chicken-egg), so production code paths that need to
      // bootstrap a fresh bowler (bulk import, season clone) call
      // `storage.createBowlerLeague` directly and we mirror that here. This
      // is what makes hasAccessToBowler resolve to the org B league for
      // session B and lets cross-org tests prove session A is denied.
      if (orgBBowlerId != null && orgBTeamId != null && orgBLeagueId != null) {
        const [row] = await db
          .insert(bowlerLeagues)
          .values({
            bowlerId: orgBBowlerId,
            leagueId: orgBLeagueId,
            teamId: orgBTeamId,
            active: true,
            order: 0,
          })
          .returning({ id: bowlerLeagues.id });
        bowlerLeagueId = row?.id ?? null;
      }
    });

    afterAll(async () => {
      // Best-effort fixture cleanup so re-runs of the suite stay
      // self-contained. Failures are non-fatal.
      try {
        if (bowlerLeagueId != null) {
          await db.delete(bowlerLeagues).where(eq(bowlerLeagues.id, bowlerLeagueId));
        }
        if (orgBBowlerId != null) {
          await db.delete(bowlersTable).where(eq(bowlersTable.id, orgBBowlerId));
        }
        if (orgBTeamId != null) {
          await db.delete(teamsTable).where(eq(teamsTable.id, orgBTeamId));
        }
      } catch {
        // ignore — leftover fixtures will be reaped by the test DB.
      }
    });

    it('org B fixtures are usable (sanity)', () => {
      expect(orgBTeamId, 'expected an org B team id').not.toBeNull();
      expect(orgBBowlerId, 'expected an org B bowler id').not.toBeNull();
    });

    it('org A GET /api/teams listing must not include the org B team id', async () => {
      const { status, data } = await apiGet<Team[]>('/api/teams', sessionA);
      expect(status).toBe(200);
      if (Array.isArray(data.data) && orgBTeamId != null) {
        const ids = collectIds(data.data);
        expect(ids).not.toContain(orgBTeamId);
      }
    });

    it('org A GET /api/teams/:id (org B team) → 403/404 and does not leak the row', async () => {
      expect(orgBTeamId).not.toBeNull();
      const { status, data } = await apiGet<Team>(`/api/teams/${orgBTeamId}`, sessionA);
      expect([403, 404]).toContain(status);
      expect(data.success).toBe(false);
      const payload = JSON.stringify(data);
      expect(payload).not.toContain(`Vitest Iso Team ${stamp}`);
    });

    it('org A GET /api/teams/:id/details (org B team) → 403/404 while session B gets 200 (positive control)', async () => {
      expect(orgBTeamId).not.toBeNull();
      const { status, data } = await apiGet(`/api/teams/${orgBTeamId}/details`, sessionA);
      expect([403, 404]).toContain(status);
      expect(data.success).toBe(false);

      // Positive control: session B (the owning org) must succeed on the
      // same id, otherwise the 403 above would be a trivial pass.
      const owner = await apiGet(`/api/teams/${orgBTeamId}/details`, sessionB);
      expect(owner.status).toBe(200);
      expect(owner.data.success).toBe(true);
    });

    it('org A GET /api/teams?leagueId=<orgBLeague> must not include the org B team', async () => {
      expect(orgBTeamId).not.toBeNull();
      expect(orgBLeagueId).not.toBeNull();
      const { status, data } = await apiGet<Team[]>(`/api/teams?leagueId=${orgBLeagueId}`, sessionA);
      // Either 200 with no rows, or denied — either is acceptable; what
      // matters is the org B team id never appears.
      expect([200, 403, 404]).toContain(status);
      if (status === 200 && Array.isArray(data.data) && orgBTeamId != null) {
        const ids = collectIds(data.data);
        expect(ids).not.toContain(orgBTeamId);
      }
    });

    it('org A PATCH /api/teams/:id (org B team) → 403/404 and does not mutate the team', async () => {
      expect(orgBTeamId).not.toBeNull();
      const before = await apiGet<Team>(`/api/teams/${orgBTeamId}`, sessionB);
      expect(before.status).toBe(200);
      const beforeName = (before.data.data as Team | undefined)?.name;

      const { status, data } = await apiPatch<Team>(
        `/api/teams/${orgBTeamId}`,
        { name: 'PWNED-by-org-A' },
        sessionA,
      );
      expect([403, 404]).toContain(status);
      expect(data.success).toBe(false);

      // Confirm via session B that no mutation actually landed.
      const after = await apiGet<Team>(`/api/teams/${orgBTeamId}`, sessionB);
      expect(after.status).toBe(200);
      expect((after.data.data as Team | undefined)?.name).toBe(beforeName);
      expect((after.data.data as Team | undefined)?.name).not.toBe('PWNED-by-org-A');
    });

    it('org A DELETE /api/teams/:id (org B team) → 403/404 and the team still exists', async () => {
      expect(orgBTeamId).not.toBeNull();
      const { status, data } = await apiDelete(`/api/teams/${orgBTeamId}`, sessionA);
      expect([403, 404]).toContain(status);
      expect(data.success).toBe(false);

      // Verify via session B that the team is still there.
      const after = await apiGet<Team>(`/api/teams/${orgBTeamId}`, sessionB);
      expect(after.status).toBe(200);
      expect(after.data.success).toBe(true);
    });

    it('org A GET /api/bowlers listing must not include the org B bowler id', async () => {
      const { status, data } = await apiGet<Bowler[]>('/api/bowlers', sessionA);
      // The endpoint may legitimately return [] when the caller has no team
      // context; what matters is that the org B id never appears.
      expect([200, 403]).toContain(status);
      if (status === 200 && Array.isArray(data.data) && orgBBowlerId != null) {
        const ids = collectIds(data.data);
        expect(ids).not.toContain(orgBBowlerId);
      }
    });

    it('org A GET /api/bowlers?teamId=<orgBTeam> → 403/404 (no leak by team filter)', async () => {
      expect(orgBTeamId).not.toBeNull();
      const { status } = await apiGet<Bowler[]>(`/api/bowlers?teamId=${orgBTeamId}`, sessionA);
      expect([403, 404]).toContain(status);
    });

    it('org A GET /api/bowlers/:id (org B bowler) → 403/404 and does not leak the row', async () => {
      expect(orgBBowlerId).not.toBeNull();
      const { status, data } = await apiGet<Bowler>(`/api/bowlers/${orgBBowlerId}`, sessionA);
      expect([403, 404]).toContain(status);
      expect(data.success).toBe(false);
      const payload = JSON.stringify(data);
      expect(payload).not.toContain(`Vitest Iso Bowler ${stamp}`);
      expect(payload).not.toContain(`vitest-iso-${stamp}@example.com`);
    });

    it('org A GET /api/bowlers/:id/details (org B bowler) → 403/404 while session B gets 200 (positive control)', async () => {
      expect(orgBBowlerId).not.toBeNull();
      const { status, data } = await apiGet(`/api/bowlers/${orgBBowlerId}/details`, sessionA);
      expect([403, 404]).toContain(status);
      expect(data.success).toBe(false);

      // Positive control: session B (the owning org) must succeed.
      const owner = await apiGet(`/api/bowlers/${orgBBowlerId}/details`, sessionB);
      expect(owner.status).toBe(200);
      expect(owner.data.success).toBe(true);
    });

    it('org A PATCH /api/bowlers/:id (org B bowler) → 403/404 and does not mutate the bowler', async () => {
      expect(orgBBowlerId).not.toBeNull();
      const before = await apiGet<Bowler>(`/api/bowlers/${orgBBowlerId}`, sessionB);
      expect(before.status).toBe(200);
      const beforeName = (before.data.data as Bowler | undefined)?.name;

      const { status, data } = await apiPatch<Bowler>(
        `/api/bowlers/${orgBBowlerId}`,
        { name: 'PWNED-bowler-by-org-A' },
        sessionA,
      );
      expect([403, 404]).toContain(status);
      expect(data.success).toBe(false);

      const after = await apiGet<Bowler>(`/api/bowlers/${orgBBowlerId}`, sessionB);
      expect(after.status).toBe(200);
      expect((after.data.data as Bowler | undefined)?.name).toBe(beforeName);
      expect((after.data.data as Bowler | undefined)?.name).not.toBe('PWNED-bowler-by-org-A');
    });

    it('org A DELETE /api/bowlers/:id (org B bowler) → 403/404 and the bowler still exists', async () => {
      expect(orgBBowlerId).not.toBeNull();
      const { status, data } = await apiDelete(`/api/bowlers/${orgBBowlerId}`, sessionA);
      expect([403, 404]).toContain(status);
      expect(data.success).toBe(false);

      const after = await apiGet<Bowler>(`/api/bowlers/${orgBBowlerId}`, sessionB);
      expect(after.status).toBe(200);
      expect(after.data.success).toBe(true);
    });
  });
});
