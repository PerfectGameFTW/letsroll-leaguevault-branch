import { Router } from 'express';
import { storage } from '../storage';
import { insertBowlerLeagueSchema, updateBowlerLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError, handleZodError } from '../utils/api';
import { hasAccessToLeague, hasAccessToTeam, hasAccessToBowler, isOrgOrHigher } from '../utils/access-control.js';
import { consumeBowlerClaim } from '../utils/bowler-claim-tokens.js';
import { createLogger } from '../logger';

const log = createLogger("BowlerLeagues");

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { bowlerId, leagueId, teamId, enriched } = req.query;

    const filters = {
      bowlerId: bowlerId ? parseInt(bowlerId as string) : undefined,
      leagueId: leagueId ? parseInt(leagueId as string) : undefined,
      teamId: teamId ? parseInt(teamId as string) : undefined
    };

    if ((bowlerId && isNaN(filters.bowlerId!)) || 
        (leagueId && isNaN(filters.leagueId!)) || 
        (teamId && isNaN(filters.teamId!))) {
      return sendError(res, "Invalid ID parameters provided", 400);
    }

    if (filters.leagueId && !(await hasAccessToLeague(req, filters.leagueId))) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    if (filters.teamId && !(await hasAccessToTeam(req, filters.teamId))) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }
    
    if (filters.bowlerId && !(await hasAccessToBowler(req, filters.bowlerId))) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    let bowlerLeagues = await storage.getBowlerLeagues(filters);

    // When fetching all bowler-leagues with no specific filters, scope to the user's org.
    // This applies to org admins AND system admins that belong to an org.
    // Only a truly unaffiliated system admin (no organizationId) sees all entries.
    if (!filters.bowlerId && !filters.leagueId && !filters.teamId) {
      const scopedOrgId: number | null = req.user?.organizationId ?? null;
      const isUnaffiliatedSystemAdmin = req.user?.role === 'system_admin' && scopedOrgId === null;

      if (isUnaffiliatedSystemAdmin) {
        // no filtering needed
      } else if (scopedOrgId !== null) {
        const orgLeagues = await storage.getLeagues(scopedOrgId);
        const orgLeagueIds = new Set(orgLeagues.map(l => l.id));
        bowlerLeagues = bowlerLeagues.filter(bl => orgLeagueIds.has(bl.leagueId));
      } else {
        bowlerLeagues = [];
      }
    }

    if (enriched === 'true') {
      const uniqueBowlerIds = [...new Set(bowlerLeagues.map(bl => bl.bowlerId))];
      const uniqueTeamIds = [...new Set(bowlerLeagues.map(bl => bl.teamId))];
      const uniqueLeagueIds = [...new Set(bowlerLeagues.map(bl => bl.leagueId))];

      const [bowlers, teams, leagues] = await Promise.all([
        Promise.all(uniqueBowlerIds.map(id => storage.getBowler(id))),
        Promise.all(uniqueTeamIds.map(id => storage.getTeam(id))),
        Promise.all(uniqueLeagueIds.map(id => storage.getLeague(id))),
      ]);

      const bowlerMap = new Map(bowlers.filter(Boolean).map(b => [b!.id, b!]));
      const teamMap = new Map(teams.filter(Boolean).map(t => [t!.id, t!]));
      const leagueMap = new Map(leagues.filter(Boolean).map(l => [l!.id, l!]));

      const enrichedData = bowlerLeagues.map(bl => {
        const bowler = bowlerMap.get(bl.bowlerId);
        const team = teamMap.get(bl.teamId);
        const league = leagueMap.get(bl.leagueId);
        return {
          ...bl,
          bowler: bowler ? { id: bowler.id, name: bowler.name, email: bowler.email, active: bowler.active } : null,
          team: team ? { id: team.id, name: team.name, number: team.number, leagueId: team.leagueId, displayOrder: team.displayOrder, active: team.active } : null,
          league: league ? { id: league.id, name: league.name, description: league.description, active: league.active } : null,
        };
      });

      return sendSuccess(res, enrichedData);
    }

    sendSuccess(res, bowlerLeagues);
  } catch (error) {
    log.error('Error:', error);
    sendError(res, 'Failed to fetch bowler leagues');
  }
});

router.post("/", async (req, res) => {
  try {
    const data = insertBowlerLeagueSchema.parse(req.body);

    if (!(await hasAccessToLeague(req, data.leagueId))) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    if (!(await hasAccessToTeam(req, data.teamId))) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }

    if (!(await hasAccessToBowler(req, data.bowlerId))) {
      // Bootstrap exception (creation-time claim token).
      //
      // A freshly created bowler has zero league entries, which makes
      // `hasAccessToBowler` deny every caller — so the public API would
      // otherwise have no way to attach a brand-new bowler to its first
      // league. Production bootstrap paths (bulk import, season clone)
      // call `storage.createBowlerLeague` directly to dodge this same
      // chicken-egg problem.
      //
      // We allow the bootstrap ONLY when:
      //   1. The caller is org_admin or system_admin. Regular bowler
      //      users that pass `hasAccessToTeam` via the league
      //      self-membership shortcut must not be able to claim other
      //      bowlers through this branch.
      //   2. The caller holds a non-expired creation-time claim token
      //      for this bowler id, registered by the same user/org via
      //      `POST /api/bowlers`. This is the safeguard against
      //      cross-org hijack: bowler rows have no owning-organization
      //      column today, so without a claim binding any org admin
      //      that knew/guessed a fresh bowler id could attach it to
      //      their own org. The claim is single-use and time-limited
      //      (see `server/utils/bowler-claim-tokens.ts`).
      //
      // Every failure mode below collapses to the same 403 to avoid
      // leaking which gate denied (existence-oracle, claim-presence
      // oracle, etc.).
      if (!isOrgOrHigher(req.user)) {
        return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
      }
      if (!consumeBowlerClaim(data.bowlerId, req)) {
        return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
      }
      // OK: org/system admin holding a valid creation-time claim.
    }

    const existing = await storage.getBowlerLeagues({
      bowlerId: data.bowlerId,
      leagueId: data.leagueId
    });

    if (existing.length > 0) {
      return sendError(res, "Bowler is already in this league", 400);
    }

    const created = await storage.createBowlerLeague(data);
    sendSuccess(res, created, 201);
  } catch (error) {
    log.error('Error:', error);
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    sendError(res, 'Failed to create bowler league');
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid ID provided");
    }

    const bowlerLeague = await storage.getBowlerLeague(id);
    if (!bowlerLeague) {
      return sendError(res, "Bowler league not found", 404);
    }

    if (!(await hasAccessToLeague(req, bowlerLeague.leagueId))) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    if (!(await hasAccessToTeam(req, bowlerLeague.teamId))) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }

    if (!(await hasAccessToBowler(req, bowlerLeague.bowlerId))) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const update = updateBowlerLeagueSchema.parse(req.body);

    if (update.teamId && !(await hasAccessToTeam(req, update.teamId))) {
      return sendError(res, "You don't have access to the target team", 403, 'FORBIDDEN');
    }

    const updated = await storage.updateBowlerLeague(id, update);
    if (!updated) {
      return sendError(res, "Bowler league not found", 404);
    }
    sendSuccess(res, updated);
  } catch (error) {
    log.error('Error:', error);
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    sendError(res, 'Failed to update bowler league');
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid ID provided", 400);
    }

    const bowlerLeague = await storage.getBowlerLeague(id);
    if (!bowlerLeague) {
      return sendError(res, "Bowler league not found", 404);
    }

    if (!(await hasAccessToLeague(req, bowlerLeague.leagueId))) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    if (!(await hasAccessToTeam(req, bowlerLeague.teamId))) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }

    if (!(await hasAccessToBowler(req, bowlerLeague.bowlerId))) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const deleted = await storage.deleteBowlerLeague(id);
    if (!deleted) {
      return sendError(res, "Bowler league not found", 404);
    }

    sendSuccess(res, { message: "Bowler league deleted successfully" }, 200);
  } catch (error) {
    log.error('Error:', error);
    sendError(res, 'Failed to delete bowler league');
  }
});

router.patch("/:id/order", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { newOrder } = req.body;

    if (isNaN(id)) {
      return sendError(res, "Invalid bowler league ID", 400);
    }

    if (typeof newOrder !== 'number') {
      return sendError(res, "New order must be a number", 400);
    }

    const bowlerLeague = await storage.getBowlerLeague(id);
    if (!bowlerLeague) {
      return sendError(res, "Bowler league not found", 404);
    }

    if (!(await hasAccessToLeague(req, bowlerLeague.leagueId))) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    if (!(await hasAccessToTeam(req, bowlerLeague.teamId))) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }

    const updated = await storage.updateBowlerLeagueOrder(id, newOrder);
    sendSuccess(res, updated);
  } catch (error) {
    log.error('Error:', error);
    sendError(res, 'Failed to update bowler league order');
  }
});

export default router;
