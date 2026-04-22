import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../server/db';
import { bowlerLeagues, bowlers as bowlersTable, teams as teamsTable } from '@shared/schema';
import {
  login,
  apiGet,
  apiPost,
  type AuthSession,
  TEST_ORG_A_EMAIL,
  TEST_ORG_B_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

interface League {
  id: number;
}
interface Team {
  id: number;
  leagueId: number;
}
interface Bowler {
  id: number;
}
interface BowlerLeague {
  id: number;
  bowlerId: number;
  leagueId: number;
  teamId: number;
}

function hasNumericId(v: unknown): v is { id: number } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { id?: unknown }).id === 'number'
  );
}

/**
 * Regression coverage for the public-API bowler bootstrap path.
 *
 * Background: `POST /api/bowler-leagues` historically called
 * `hasAccessToBowler` unconditionally, which returns false for any bowler
 * with zero existing league entries. That made the "create a fresh bowler,
 * then attach them to a team" public-API flow impossible — every caller
 * got 403, and production code paths (bulk import, season clone) had to
 * call `storage.createBowlerLeague` directly to dodge the check.
 *
 * Task #340 added a bootstrap exception gated by a creation-time claim
 * token (server/utils/bowler-claim-tokens.ts): when POST /api/bowlers
 * succeeds, an ephemeral token bound to the creating user/org is
 * registered for the new bowler id. The bootstrap branch in
 * /api/bowler-leagues consumes that token before allowing the link. This
 * prevents cross-org admins from hijacking a freshly created bowler in
 * the brief window before its first link.
 */
describe('POST /api/bowler-leagues — bootstrap path for fresh bowlers', () => {
  let sessionA: AuthSession;
  let sessionB: AuthSession;
  let leagueId: number | null = null;
  let teamId: number | null = null;
  const stamp = Date.now();
  const uniqueTeamNumber = (stamp % 90000) + 10000;

  // Track every row we create across all `it` blocks so afterAll can clean
  // up regardless of which case ran.
  const createdBowlerLeagueIds: number[] = [];
  const createdBowlerIds: number[] = [];

  beforeAll(async () => {
    sessionA = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    sessionB = await login(TEST_ORG_B_EMAIL, TEST_ORG_PASSWORD);

    // Need an org B league for the link target.
    const leagues = await apiGet<League[]>('/api/leagues', sessionB);
    expect(leagues.status).toBe(200);
    const list = Array.isArray(leagues.data.data) ? leagues.data.data : [];
    expect(list.length, 'expected at least one league for org B').toBeGreaterThan(0);
    leagueId = list[0].id;

    // Create a fresh team to use as the link target.
    const team = await apiPost<Team>(
      '/api/teams',
      { name: `Vitest Bootstrap Team ${stamp}`, number: uniqueTeamNumber, leagueId, active: true },
      sessionB,
    );
    expect(team.status).toBe(201);
    if (team.status === 201 && hasNumericId(team.data.data)) {
      teamId = team.data.data.id;
    }
  });

  afterAll(async () => {
    try {
      for (const id of createdBowlerLeagueIds) {
        await db.delete(bowlerLeagues).where(eq(bowlerLeagues.id, id));
      }
      for (const id of createdBowlerIds) {
        await db.delete(bowlersTable).where(eq(bowlersTable.id, id));
      }
      if (teamId != null) {
        await db.delete(teamsTable).where(eq(teamsTable.id, teamId));
      }
    } catch {
      // best-effort
    }
  });

  it('org admin can attach a freshly created bowler (with creation-time claim) to a team in their org', async () => {
    expect(leagueId).not.toBeNull();
    expect(teamId).not.toBeNull();

    const bowlerRes = await apiPost<Bowler>(
      '/api/bowlers',
      {
        name: `Vitest Bootstrap Bowler ${stamp}-1`,
        email: `vitest-bootstrap-${stamp}-1@example.com`,
        active: true,
      },
      sessionB,
    );
    expect(bowlerRes.status).toBe(201);
    expect(hasNumericId(bowlerRes.data.data)).toBe(true);
    const bowlerId = (bowlerRes.data.data as Bowler).id;
    createdBowlerIds.push(bowlerId);

    // Bootstrap link via the same session that created the bowler.
    const linkRes = await apiPost<BowlerLeague>(
      '/api/bowler-leagues',
      { bowlerId, leagueId, teamId, active: true, order: 0 },
      sessionB,
    );

    expect(linkRes.status, JSON.stringify(linkRes.data)).toBe(201);
    expect(linkRes.data.success).toBe(true);
    expect(hasNumericId(linkRes.data.data)).toBe(true);
    const created = linkRes.data.data as BowlerLeague;
    expect(created.bowlerId).toBe(bowlerId);
    expect(created.leagueId).toBe(leagueId);
    expect(created.teamId).toBe(teamId);
    createdBowlerLeagueIds.push(created.id);
  });

  it('returns 403 (not 404) when the bootstrap caller targets a non-existent bowler — no existence oracle', async () => {
    expect(leagueId).not.toBeNull();
    expect(teamId).not.toBeNull();

    // Pick a bowler id that almost certainly does not exist. Any positive
    // integer that's never been used by the test DB will do; 2_147_000_000
    // is well below int4 max but safely above any seeded id.
    const phantomBowlerId = 2_147_000_000;

    const linkRes = await apiPost(
      '/api/bowler-leagues',
      { bowlerId: phantomBowlerId, leagueId, teamId, active: true, order: 0 },
      sessionB,
    );

    // Must be 403, not 404: returning 404 here would leak whether the
    // bowler id exists at all to any org admin who can hit this endpoint.
    expect(linkRes.status).toBe(403);
    expect(linkRes.data.success).toBe(false);
  });

  it('blocks bootstrap when the bowler already has league entries (claim is single-use)', async () => {
    expect(leagueId).not.toBeNull();
    expect(teamId).not.toBeNull();

    // Create a bowler and consume its claim by linking once.
    const bowlerRes = await apiPost<Bowler>(
      '/api/bowlers',
      {
        name: `Vitest Bootstrap Bowler ${stamp}-2`,
        email: `vitest-bootstrap-${stamp}-2@example.com`,
        active: true,
      },
      sessionB,
    );
    expect(bowlerRes.status).toBe(201);
    const bowlerId = (bowlerRes.data.data as Bowler).id;
    createdBowlerIds.push(bowlerId);

    const firstLink = await apiPost<BowlerLeague>(
      '/api/bowler-leagues',
      { bowlerId, leagueId, teamId, active: true, order: 0 },
      sessionB,
    );
    expect(firstLink.status).toBe(201);
    createdBowlerLeagueIds.push((firstLink.data.data as BowlerLeague).id);

    // Re-posting the exact same link must hit the "already in this league"
    // 400 branch (the regular hasAccessToBowler check now succeeds because
    // the bowler has a league entry).
    const secondLink = await apiPost(
      '/api/bowler-leagues',
      { bowlerId, leagueId, teamId, active: true, order: 0 },
      sessionB,
    );
    expect(secondLink.status).toBe(400);
    expect(secondLink.data.success).toBe(false);
  });

  it('does NOT let an org A admin claim an org B bowler via bootstrap (cross-org adversarial — strict 403)', async () => {
    expect(leagueId).not.toBeNull();

    // Org B creates a fresh bowler. The claim token is registered for
    // sessionB's user/org, NOT for sessionA.
    const bowlerRes = await apiPost<Bowler>(
      '/api/bowlers',
      {
        name: `Vitest Bootstrap Bowler ${stamp}-4`,
        email: `vitest-bootstrap-${stamp}-4@example.com`,
        active: true,
      },
      sessionB,
    );
    expect(bowlerRes.status).toBe(201);
    const bowlerId = (bowlerRes.data.data as Bowler).id;
    createdBowlerIds.push(bowlerId);

    // Resolve org A's own league + team to use as the hijack target.
    const orgALeagues = await apiGet<League[]>('/api/leagues', sessionA);
    expect(orgALeagues.status).toBe(200);
    const aLeagues = Array.isArray(orgALeagues.data.data) ? orgALeagues.data.data : [];
    if (aLeagues.length === 0) {
      // Skip without failing if org A has no fixtures.
      return;
    }
    const orgALeagueId = aLeagues[0].id;
    const orgATeams = await apiGet<Team[]>(`/api/teams?leagueId=${orgALeagueId}`, sessionA);
    if (
      orgATeams.status !== 200 ||
      !Array.isArray(orgATeams.data.data) ||
      orgATeams.data.data.length === 0
    ) {
      return;
    }
    const orgATeamId = orgATeams.data.data[0].id;

    // Org A admin attempts to bootstrap-link org B's fresh bowler to org
    // A's own league/team. The claim token belongs to sessionB's user,
    // so consumeBowlerClaim must return false for sessionA → strict 403.
    const hijack = await apiPost(
      '/api/bowler-leagues',
      { bowlerId, leagueId: orgALeagueId, teamId: orgATeamId, active: true, order: 0 },
      sessionA,
    );

    expect(hijack.status).toBe(403);
    expect(hijack.data.success).toBe(false);

    // Defense in depth: confirm no link to org A's resources actually
    // landed for the org B bowler.
    const remainingLinks = await db
      .select({ id: bowlerLeagues.id })
      .from(bowlerLeagues)
      .where(eq(bowlerLeagues.bowlerId, bowlerId));
    expect(remainingLinks.length).toBe(0);
  });

  it('claim token is single-use: a second bootstrap attempt for the same fresh bowler is rejected', async () => {
    expect(leagueId).not.toBeNull();
    expect(teamId).not.toBeNull();

    const bowlerRes = await apiPost<Bowler>(
      '/api/bowlers',
      {
        name: `Vitest Bootstrap Bowler ${stamp}-5`,
        email: `vitest-bootstrap-${stamp}-5@example.com`,
        active: true,
      },
      sessionB,
    );
    expect(bowlerRes.status).toBe(201);
    const bowlerId = (bowlerRes.data.data as Bowler).id;
    createdBowlerIds.push(bowlerId);

    // First link consumes the claim.
    const first = await apiPost<BowlerLeague>(
      '/api/bowler-leagues',
      { bowlerId, leagueId, teamId, active: true, order: 0 },
      sessionB,
    );
    expect(first.status).toBe(201);
    const firstLinkId = (first.data.data as BowlerLeague).id;
    createdBowlerLeagueIds.push(firstLinkId);

    // Soft-deactivate the link so the bowler appears "free-floating" to
    // the active-only storage helper. Without the claim-token gate, the
    // old link-count check would have allowed re-claiming. With the
    // claim gate, the token is already consumed and the second attempt
    // must be rejected.
    await db
      .update(bowlerLeagues)
      .set({ active: false })
      .where(eq(bowlerLeagues.id, firstLinkId));

    const second = await apiPost(
      '/api/bowler-leagues',
      { bowlerId, leagueId, teamId, active: true, order: 0 },
      sessionB,
    );
    expect(second.status).toBe(403);
    expect(second.data.success).toBe(false);
  });
});
