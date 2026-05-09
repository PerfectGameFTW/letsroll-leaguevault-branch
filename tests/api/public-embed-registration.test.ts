/**
 * Task #681 — coverage for the public, no-auth embed registration
 * endpoints. Verifies the security gates, multi-child happy path,
 * roster cap atomicity, and guardian-required enforcement.
 *
 * Cleanup contract: every row inserted is deleted in `afterAll`,
 * including the league, the auto-created Unassigned team, the
 * bowlers + bowler_leagues + league_registrations + bowler_guardians
 * + guardian users. No leakage to the shared dev DB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray, and } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  leagues,
  teams,
  bowlers,
  bowlerLeagues,
  bowlerGuardians,
  leagueRegistrations,
  users,
} from '@shared/schema';
import { BASE_URL, getBaselineOrgAId } from '../helpers';

interface EmbedResp {
  success: boolean;
  data?: { bowlerIds: number[]; registrationIds: number[] };
  error?: { message: string; code?: string };
}

async function publicGet(leagueId: number) {
  const r = await fetch(`${BASE_URL}/api/public/embed/leagues/${leagueId}`, {
    headers: { 'x-test-rate-limit-bypass': '1' },
  });
  return { status: r.status, body: (await r.json()) as { success: boolean; data?: unknown; error?: { code?: string } } };
}

async function publicSubmit(body: unknown) {
  const r = await fetch(`${BASE_URL}/api/public/embed/registrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-rate-limit-bypass': '1',
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as EmbedResp };
}

describe('public embed registration endpoints', () => {
  let orgAId: number;
  let openLeagueId: number;
  let cappedLeagueId: number;
  let nonPublicLeagueId: number;
  let nonYouthLeagueId: number;
  const stamp = Date.now();
  const guardianEmail = `vitest-embed-guardian-${stamp}@example.test`;

  beforeAll(async () => {
    orgAId = await getBaselineOrgAId();

    const baseFields = {
      organizationId: orgAId,
      seasonStart: '2099-01-01',
      seasonEnd: '2099-12-31',
      weekDay: 'Saturday' as const,
      weeklyFee: 0,
      paymentMode: 'weekly' as const,
      active: true,
      seasonNumber: 1,
    };

    const [openL] = await db
      .insert(leagues)
      .values({
        ...baseFields,
        name: `Vitest Embed Open ${stamp}`,
        isYouth: true,
        allowPublicSignup: true,
      })
      .returning();
    openLeagueId = openL.id;

    const [cappedL] = await db
      .insert(leagues)
      .values({
        ...baseFields,
        name: `Vitest Embed Capped ${stamp}`,
        isYouth: true,
        allowPublicSignup: true,
        rosterCap: 1,
      })
      .returning();
    cappedLeagueId = cappedL.id;

    const [closedL] = await db
      .insert(leagues)
      .values({
        ...baseFields,
        name: `Vitest Embed Closed ${stamp}`,
        isYouth: true,
        allowPublicSignup: false,
      })
      .returning();
    nonPublicLeagueId = closedL.id;

    const [adultL] = await db
      .insert(leagues)
      .values({
        ...baseFields,
        name: `Vitest Embed Adult ${stamp}`,
        isYouth: false,
        allowPublicSignup: true,
      })
      .returning();
    nonYouthLeagueId = adultL.id;
  });

  afterAll(async () => {
    const leagueIds = [openLeagueId, cappedLeagueId, nonPublicLeagueId, nonYouthLeagueId].filter(
      (n) => typeof n === 'number',
    );
    if (leagueIds.length === 0) return;

    const regRows = await db
      .select({ id: leagueRegistrations.id, bowlerId: leagueRegistrations.bowlerId })
      .from(leagueRegistrations)
      .where(inArray(leagueRegistrations.leagueId, leagueIds));
    const bowlerIds = Array.from(new Set(regRows.map((r) => r.bowlerId).filter((b): b is number => b !== null)));

    if (regRows.length > 0) {
      await db.delete(leagueRegistrations).where(inArray(leagueRegistrations.leagueId, leagueIds));
    }
    if (bowlerIds.length > 0) {
      await db.delete(bowlerGuardians).where(inArray(bowlerGuardians.childBowlerId, bowlerIds));
      await db.delete(bowlerLeagues).where(inArray(bowlerLeagues.bowlerId, bowlerIds));
      await db.delete(bowlers).where(inArray(bowlers.id, bowlerIds));
    }
    await db.delete(teams).where(inArray(teams.leagueId, leagueIds));
    await db.delete(leagues).where(inArray(leagues.id, leagueIds));

    // Guardian user created by the happy-path submit (idempotent if missing).
    await db.delete(users).where(eq(users.email, guardianEmail));
  });

  describe('security gates', () => {
    it('GET 404s a non-public league', async () => {
      const r = await publicGet(nonPublicLeagueId);
      expect(r.status).toBe(404);
      expect(r.body?.error?.code).toBe('NOT_FOUND');
    });

    it('GET 404s a non-youth league', async () => {
      const r = await publicGet(nonYouthLeagueId);
      expect(r.status).toBe(404);
    });

    it('POST 404s a non-public league even with valid payload', async () => {
      const r = await publicSubmit({
        leagueId: nonPublicLeagueId,
        children: [{ name: 'Should Not Land', isMinor: true }],
        guardian: { name: 'G', email: guardianEmail, relationship: 'parent' },
      });
      expect(r.status).toBe(404);
    });

    it('POST 404s a non-youth league even with valid payload', async () => {
      const r = await publicSubmit({
        leagueId: nonYouthLeagueId,
        children: [{ name: 'Should Not Land', isMinor: true }],
        guardian: { name: 'G', email: guardianEmail, relationship: 'parent' },
      });
      expect(r.status).toBe(404);
    });
  });

  describe('happy path', () => {
    it('GET returns league + org branding', async () => {
      const r = await publicGet(openLeagueId);
      expect(r.status).toBe(200);
      const body = r.body as { data: { league: { id: number; isYouth: boolean }; organization: { id: number } } };
      expect(body.data.league.id).toBe(openLeagueId);
      expect(body.data.league.isYouth).toBe(true);
      expect(body.data.organization.id).toBe(orgAId);
    });

    it('POST registers multiple children under one guardian', async () => {
      const r = await publicSubmit({
        leagueId: openLeagueId,
        children: [
          { name: `Vitest Kid A ${stamp}`, isMinor: true },
          { name: `Vitest Kid B ${stamp}`, isMinor: true },
        ],
        guardian: {
          name: 'Vitest Guardian',
          email: guardianEmail,
          phone: null,
          relationship: 'parent',
        },
      });
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      expect(r.body.data?.bowlerIds.length).toBe(2);
      expect(r.body.data?.registrationIds.length).toBe(2);

      // Confirm rows landed on the Unassigned bucket and are linked.
      const links = await db
        .select({ id: bowlerLeagues.id, teamId: bowlerLeagues.teamId })
        .from(bowlerLeagues)
        .where(
          and(
            eq(bowlerLeagues.leagueId, openLeagueId),
            inArray(bowlerLeagues.bowlerId, r.body.data?.bowlerIds ?? []),
          ),
        );
      expect(links.length).toBe(2);
      // Both children should land on the SAME unassigned team.
      expect(new Set(links.map((l) => l.teamId)).size).toBe(1);
    });

    it('rejects minor without guardian', async () => {
      const r = await publicSubmit({
        leagueId: openLeagueId,
        children: [{ name: 'Lonely Kid', isMinor: true }],
      });
      expect(r.status).toBe(400);
      expect(r.body.error?.code).toBe('GUARDIAN_REQUIRED');
    });
  });

  describe('roster cap', () => {
    it('rejects multi-child submit that would overflow the cap', async () => {
      // cap=1 league, 2 children → ROSTER_FULL
      const r = await publicSubmit({
        leagueId: cappedLeagueId,
        children: [
          { name: `Cap Kid 1 ${stamp}`, isMinor: true },
          { name: `Cap Kid 2 ${stamp}`, isMinor: true },
        ],
        guardian: { name: 'G', email: guardianEmail, relationship: 'parent' },
      });
      expect(r.status).toBe(409);
      expect(r.body.error?.code).toBe('ROSTER_FULL');

      // ...and partial registration must NOT have happened.
      const links = await db
        .select({ id: bowlerLeagues.id })
        .from(bowlerLeagues)
        .where(eq(bowlerLeagues.leagueId, cappedLeagueId));
      expect(links.length).toBe(0);
    });

    it('accepts one child up to the cap, then rejects the next', async () => {
      const ok = await publicSubmit({
        leagueId: cappedLeagueId,
        children: [{ name: `Cap Kid Solo ${stamp}`, isMinor: true }],
        guardian: { name: 'G', email: guardianEmail, relationship: 'parent' },
      });
      expect(ok.status).toBe(200);

      const blocked = await publicSubmit({
        leagueId: cappedLeagueId,
        children: [{ name: `Cap Kid Overflow ${stamp}`, isMinor: true }],
        guardian: { name: 'G', email: guardianEmail, relationship: 'parent' },
      });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error?.code).toBe('ROSTER_FULL');
    });
  });

  describe('legacy single-bowler payload', () => {
    it('accepts the old { bowler: {...} } shape via normalization', async () => {
      const r = await publicSubmit({
        leagueId: openLeagueId,
        bowler: { name: `Vitest Legacy ${stamp}`, isMinor: true },
        guardian: { name: 'G', email: guardianEmail, relationship: 'parent' },
      });
      expect(r.status).toBe(200);
      expect(r.body.data?.bowlerIds.length).toBe(1);
    });
  });
});
