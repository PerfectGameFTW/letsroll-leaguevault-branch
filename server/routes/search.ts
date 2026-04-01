import { Router } from 'express';
import { db } from '../db.js';
import { leagues } from '@shared/schema';
import { teams } from '@shared/schema';
import { bowlers, bowlerLeagues } from '@shared/schema';
import { sql, ilike, eq, or, and, inArray } from 'drizzle-orm';
import { sendSuccess, sendError } from '../utils/api.js';
import { createLogger } from '../logger';

const log = createLogger("Search");
const router = Router();

const MAX_RESULTS_PER_CATEGORY = 5;

router.get("/", async (req: any, res) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q || q.length < 2) {
      return sendSuccess(res, { leagues: [], teams: [], bowlers: [] });
    }

    const isSystemAdmin = req.user?.role === 'system_admin';
    const organizationId: number | null = req.user?.organizationId ?? null;

    if (!isSystemAdmin && !organizationId) {
      return sendSuccess(res, { leagues: [], teams: [], bowlers: [] });
    }

    const pattern = `%${q}%`;

    const leagueConditions = [ilike(leagues.name, pattern)];
    if (!isSystemAdmin && organizationId) {
      leagueConditions.push(eq(leagues.organizationId, organizationId));
    }

    const matchedLeagues = await db
      .select({ id: leagues.id, name: leagues.name, active: leagues.active })
      .from(leagues)
      .where(and(...leagueConditions))
      .limit(MAX_RESULTS_PER_CATEGORY);

    let matchedTeams: { id: number; name: string; number: number; leagueId: number; leagueName: string | null }[] = [];
    if (!isSystemAdmin && organizationId) {
      matchedTeams = await db
        .select({
          id: teams.id,
          name: teams.name,
          number: teams.number,
          leagueId: teams.leagueId,
          leagueName: leagues.name,
        })
        .from(teams)
        .innerJoin(leagues, eq(teams.leagueId, leagues.id))
        .where(and(
          ilike(teams.name, pattern),
          eq(leagues.organizationId, organizationId)
        ))
        .limit(MAX_RESULTS_PER_CATEGORY);
    } else {
      matchedTeams = await db
        .select({
          id: teams.id,
          name: teams.name,
          number: teams.number,
          leagueId: teams.leagueId,
          leagueName: leagues.name,
        })
        .from(teams)
        .innerJoin(leagues, eq(teams.leagueId, leagues.id))
        .where(ilike(teams.name, pattern))
        .limit(MAX_RESULTS_PER_CATEGORY);
    }

    let matchedBowlers: { id: number; name: string; email: string | null }[] = [];
    if (!isSystemAdmin && organizationId) {
      const orgLeagues = await db
        .select({ id: leagues.id })
        .from(leagues)
        .where(eq(leagues.organizationId, organizationId));
      const orgLeagueIds = orgLeagues.map(l => l.id);

      if (orgLeagueIds.length > 0) {
        const orgBowlerRows = await db
          .selectDistinct({ bowlerId: bowlerLeagues.bowlerId })
          .from(bowlerLeagues)
          .where(inArray(bowlerLeagues.leagueId, orgLeagueIds));
        const orgBowlerIds = orgBowlerRows.map(r => r.bowlerId);

        if (orgBowlerIds.length > 0) {
          matchedBowlers = await db
            .select({ id: bowlers.id, name: bowlers.name, email: bowlers.email })
            .from(bowlers)
            .where(and(
              inArray(bowlers.id, orgBowlerIds),
              or(
                ilike(bowlers.name, pattern),
                ilike(bowlers.email, pattern)
              )
            ))
            .limit(MAX_RESULTS_PER_CATEGORY);
        }
      }
    } else {
      matchedBowlers = await db
        .select({ id: bowlers.id, name: bowlers.name, email: bowlers.email })
        .from(bowlers)
        .where(or(
          ilike(bowlers.name, pattern),
          ilike(bowlers.email, pattern)
        ))
        .limit(MAX_RESULTS_PER_CATEGORY);
    }

    sendSuccess(res, {
      leagues: matchedLeagues,
      teams: matchedTeams,
      bowlers: matchedBowlers,
    });
  } catch (error) {
    log.error('Search error:', error);
    sendError(res, 'Search failed');
  }
});

export default router;
