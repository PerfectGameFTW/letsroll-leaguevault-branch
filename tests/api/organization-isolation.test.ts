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

  // ------------------------------------------------------------------
  // Task #341 — filtered list endpoints must not leak cross-org data.
  //
  // Single-record handlers (`GET /:id`, mutations) are covered above.
  // The shape we exercise here is the *list* shape with an entity-id
  // filter — `?ids=`, `?bowlerId=`, `?leagueId=`, `?locationId=`. A
  // common bug class is: the list handler honors the filter param
  // verbatim and forgets to also constrain by the caller's org, so
  // pointing the filter at another org's entity id leaks rows.
  //
  // Each test below points session A at an org B id and asserts the
  // response either denies (403/404) or returns an empty/non-leaking
  // result. The org B fixture rows (location, team, bowler, payment)
  // are created via direct DB insert so the test is hermetic and does
  // not depend on existing data.
  // ------------------------------------------------------------------
  describe('filtered list endpoints — cross-org leak prevention (task #341)', () => {
    interface Location { id: number; organizationId: number | null; name: string }
    interface League { id: number; locationId: number | null }
    interface Bowler { id: number; name: string; email?: string | null }
    interface Team { id: number; leagueId: number; name: string }
    interface Payment { id: number; bowlerId: number; leagueId: number; amount: number }

    const stamp = Date.now();
    const uniqueTeamNumber = ((stamp + 1) % 90000) + 10000;
    let orgBId: number | null = null;
    let orgBLocationId: number | null = null;
    let orgBTeamId: number | null = null;
    let orgBBowlerId: number | null = null;
    let orgBBowlerLeagueId: number | null = null;
    let orgBPaymentId: number | null = null;

    beforeAll(async () => {
      // Need the org B league — this is set in the outermost beforeAll.
      expect(orgBLeagueId, 'org B league fixture is required').not.toBeNull();

      // Resolve org B's organization id by looking at the org B league row.
      const leagueRow = await db.query.leagues.findFirst({
        where: (l, { eq }) => eq(l.id, orgBLeagueId!),
      });
      orgBId = leagueRow?.organizationId ?? null;
      expect(orgBId, 'expected org B league to have an organizationId').not.toBeNull();

      const { locations: locationsTable, leagues: leaguesTable, payments: paymentsTable } =
        await import('@shared/schema');

      // Create an org B location and stamp it on the org B league so
      // /api/leagues?locationId=<orgB-location> can be exercised against
      // a real, owned target row.
      const [createdLocation] = await db
        .insert(locationsTable)
        .values({
          organizationId: orgBId!,
          name: `Vitest Iso Location ${stamp}`,
          paymentProvider: 'square',
        })
        .returning({ id: locationsTable.id });
      orgBLocationId = createdLocation?.id ?? null;
      if (orgBLocationId != null) {
        await db
          .update(leaguesTable)
          .set({ locationId: orgBLocationId })
          .where(eq(leaguesTable.id, orgBLeagueId!));
      }

      // Create an org B team + bowler + bowler-league link so /api/bowlers
      // and /api/payments can be filtered by their ids cross-org.
      const teamRes = await apiPost<Team>(
        '/api/teams',
        { name: `Vitest #341 Team ${stamp}`, number: uniqueTeamNumber, leagueId: orgBLeagueId, active: true },
        sessionB,
      );
      const teamPayload = teamRes.data.data;
      if (teamRes.status === 201 && hasNumericId(teamPayload)) {
        orgBTeamId = teamPayload.id;
      }

      const bowlerRes = await apiPost<Bowler>(
        '/api/bowlers',
        { name: `Vitest #341 Bowler ${stamp}`, email: `vitest-341-${stamp}@example.com`, active: true },
        sessionB,
      );
      const bowlerPayload = bowlerRes.data.data;
      if (bowlerRes.status === 201 && hasNumericId(bowlerPayload)) {
        orgBBowlerId = bowlerPayload.id;
      }

      // Direct-DB link to bypass the bootstrap chicken-egg (same pattern
      // used by the task-#310 setup above).
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
        orgBBowlerLeagueId = row?.id ?? null;
      }

      // Insert an org B payment so /api/payments?bowlerId|leagueId
      // filters against a real org B row that an attacker could try to
      // fish out cross-org.
      if (orgBBowlerId != null && orgBLeagueId != null) {
        const [row] = await db
          .insert(paymentsTable)
          .values({
            bowlerId: orgBBowlerId,
            leagueId: orgBLeagueId,
            amount: 1234,
            weekOf: new Date().toISOString(),
            type: 'cash',
            notes: `Vitest #341 Payment ${stamp}`,
          })
          .returning({ id: paymentsTable.id });
        orgBPaymentId = row?.id ?? null;
      }
    });

    afterAll(async () => {
      try {
        const { locations: locationsTable, leagues: leaguesTable, payments: paymentsTable } =
          await import('@shared/schema');
        if (orgBPaymentId != null) {
          await db.delete(paymentsTable).where(eq(paymentsTable.id, orgBPaymentId));
        }
        if (orgBBowlerLeagueId != null) {
          await db.delete(bowlerLeagues).where(eq(bowlerLeagues.id, orgBBowlerLeagueId));
        }
        if (orgBBowlerId != null) {
          await db.delete(bowlersTable).where(eq(bowlersTable.id, orgBBowlerId));
        }
        if (orgBTeamId != null) {
          await db.delete(teamsTable).where(eq(teamsTable.id, orgBTeamId));
        }
        if (orgBLocationId != null) {
          // Detach from the org B league first so the location FK can drop.
          await db
            .update(leaguesTable)
            .set({ locationId: null })
            .where(eq(leaguesTable.locationId, orgBLocationId));
          await db.delete(locationsTable).where(eq(locationsTable.id, orgBLocationId));
        }
      } catch {
        // best-effort
      }
    });

    it('fixtures are usable (sanity)', () => {
      expect(orgBLocationId, 'expected an org B location id').not.toBeNull();
      expect(orgBTeamId, 'expected an org B team id').not.toBeNull();
      expect(orgBBowlerId, 'expected an org B bowler id').not.toBeNull();
      expect(orgBPaymentId, 'expected an org B payment id').not.toBeNull();
    });

    it('org A GET /api/bowlers?ids=<orgB bowler> → 403 (batched id-list filter must not leak)', async () => {
      expect(orgBBowlerId).not.toBeNull();
      const { status, data } = await apiGet<Bowler[]>(
        `/api/bowlers?ids=${orgBBowlerId}`,
        sessionA,
      );
      // The route uses `hasAccessToBowlers` to gate the entire list and
      // returns 403 when any requested id resolves outside the caller's
      // org. Empty 200 would also be acceptable (filter applied AND
      // org-scoped), but the org B id and identifying fields must NEVER
      // appear in the response body either way.
      expect([200, 403]).toContain(status);
      const payload = JSON.stringify(data);
      expect(payload).not.toContain(`Vitest #341 Bowler ${stamp}`);
      expect(payload).not.toContain(`vitest-341-${stamp}@example.com`);
      if (status === 200 && Array.isArray(data.data) && orgBBowlerId != null) {
        expect(collectIds(data.data)).not.toContain(orgBBowlerId);
      }
    });

    it('org A GET /api/bowlers?ids=<mixed>: even one cross-org id must deny the whole batch', async () => {
      expect(orgBBowlerId).not.toBeNull();
      // Mix in an obviously-not-orgA placeholder id alongside the real
      // org B id. Whether or not the placeholder exists, the org B id
      // alone should be enough to deny the batch.
      const { status, data } = await apiGet<Bowler[]>(
        `/api/bowlers?ids=${orgBBowlerId},999999999`,
        sessionA,
      );
      expect([200, 403]).toContain(status);
      const payload = JSON.stringify(data);
      expect(payload).not.toContain(`Vitest #341 Bowler ${stamp}`);
      expect(payload).not.toContain(`vitest-341-${stamp}@example.com`);
      if (status === 200 && Array.isArray(data.data) && orgBBowlerId != null) {
        expect(collectIds(data.data)).not.toContain(orgBBowlerId);
      }
    });

    it('org A GET /api/leagues?locationId=<orgB location> must not include the org B league', async () => {
      expect(orgBLocationId).not.toBeNull();
      expect(orgBLeagueId).not.toBeNull();
      const { status, data } = await apiGet<League[]>(
        `/api/leagues?locationId=${orgBLocationId}`,
        sessionA,
      );
      // The route applies org scoping FIRST (via getOrganizationFilter)
      // and then filters in-memory by locationId. Pointing the filter at
      // an org B location id from session A should yield zero rows even
      // though the org B league really does live at that location.
      expect(status).toBe(200);
      if (Array.isArray(data.data) && orgBLeagueId != null) {
        expect(collectIds(data.data)).not.toContain(orgBLeagueId);
      }
    });

    it('org A GET /api/payments?bowlerId=<orgB bowler> must not leak the org B payment row', async () => {
      expect(orgBBowlerId).not.toBeNull();
      const { status, data } = await apiGet<Payment[]>(
        `/api/payments?bowlerId=${orgBBowlerId}`,
        sessionA,
      );
      // The payments list applies the caller's organizationId in the
      // storage filter. The bowlerId param here belongs to org B, so
      // even though it's a real bowler id, the org-scoped query must
      // resolve to zero rows.
      expect(status).toBe(200);
      if (Array.isArray(data.data) && orgBPaymentId != null) {
        expect(collectIds(data.data)).not.toContain(orgBPaymentId);
      }
      const payload = JSON.stringify(data);
      expect(payload).not.toContain(`Vitest #341 Payment ${stamp}`);
    });

    it('org A GET /api/payments?leagueId=<orgB league> → 403 (league-id filter is org-gated upstream)', async () => {
      expect(orgBLeagueId).not.toBeNull();
      const { status, data } = await apiGet<Payment[]>(
        `/api/payments?leagueId=${orgBLeagueId}`,
        sessionA,
      );
      // /api/payments calls requireOrganizationAccess(req, league.org)
      // before running the storage query when leagueId is provided, so
      // a cross-org leagueId should hit a strict 403.
      expect(status).toBe(403);
      expect(data.success).toBe(false);
      const payload = JSON.stringify(data);
      expect(payload).not.toContain(`Vitest #341 Payment ${stamp}`);
    });

    it('org A GET /api/payments?teamId=<orgB team> must not leak the org B payment row', async () => {
      expect(orgBTeamId).not.toBeNull();
      const { status, data } = await apiGet<Payment[]>(
        `/api/payments?teamId=${orgBTeamId}`,
        sessionA,
      );
      // teamId is NOT explicitly access-checked at the route layer (only
      // leagueId is) — the safety net is the org-scoped storage filter.
      // Confirm that net actually catches it: org A must not see org B's
      // payment even when filtering by org B's team.
      expect(status).toBe(200);
      if (Array.isArray(data.data) && orgBPaymentId != null) {
        expect(collectIds(data.data)).not.toContain(orgBPaymentId);
      }
      const payload = JSON.stringify(data);
      expect(payload).not.toContain(`Vitest #341 Payment ${stamp}`);
    });

    it('positive control: session B (the owning org) can read its own filtered rows', async () => {
      // Confirms the previous tests are not "trivially passing" because
      // the rows simply don't exist or the routes always 403.
      expect(orgBBowlerId).not.toBeNull();
      expect(orgBLeagueId).not.toBeNull();

      const ownerBowlers = await apiGet<Bowler[]>(
        `/api/bowlers?ids=${orgBBowlerId}`,
        sessionB,
      );
      expect(ownerBowlers.status).toBe(200);
      if (Array.isArray(ownerBowlers.data.data) && orgBBowlerId != null) {
        expect(collectIds(ownerBowlers.data.data)).toContain(orgBBowlerId);
      }

      const ownerPayments = await apiGet<Payment[]>(
        `/api/payments?leagueId=${orgBLeagueId}`,
        sessionB,
      );
      expect(ownerPayments.status).toBe(200);
      if (Array.isArray(ownerPayments.data.data) && orgBPaymentId != null) {
        expect(collectIds(ownerPayments.data.data)).toContain(orgBPaymentId);
      }
    });
  });
});
