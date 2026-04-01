import { Router } from 'express';
import { storage } from '../storage';
import { insertTeamSchema, updateTeamSchema, reorderTeamsSchema, type Team } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError, handleZodError } from '../utils/api.js';

const router = Router();

router.get("/", async (req, res) => {
  try {
    const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
    
    // If a league ID is provided, we need to check if the user has access to that league
    let teams: Team[] = [];
    
    if (leagueId) {
      // First, get the league to check its organization
      const league = await storage.getLeague(leagueId);
      
      if (!league) {
        return sendError(res, "League not found", 404, 'NOT_FOUND');
      }
      
      // Check if user has access to this league's organization
      const userHasAccess = 
        req.user?.role === 'system_admin' || 
        league.organizationId === null || 
        (req.user?.organizationId === league.organizationId);
      
      if (userHasAccess) {
        teams = await storage.getTeams(leagueId);
      } else {
        return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
      }
    } else {
      // If no league ID, scope to the user's org (applies to org admins AND system admins
      // that belong to an org). Only a truly unaffiliated system admin sees all teams.
      const scopedOrgId: number | null = req.user?.organizationId ?? null;

      if (req.user?.role === 'system_admin' && scopedOrgId === null) {
        // Unaffiliated system admin: see all teams
        teams = await storage.getTeams();
      } else if (scopedOrgId !== null) {
        const leagues = await storage.getLeagues(scopedOrgId);
        const teamPromises = leagues.map(league => storage.getTeams(league.id));
        const teamsArrays = await Promise.all(teamPromises);
        teams = teamsArrays.flat();
      } else {
        teams = [];
      }
    }
    
    sendSuccess(res, teams);
  } catch (error) {
    sendError(res, 'Failed to fetch teams');
  }
});

router.patch("/reorder", async (req, res) => {
  try {
    const { teams: teamUpdates } = reorderTeamsSchema.parse(req.body);

    if (teamUpdates.length === 0) {
      return sendSuccess(res, null);
    }

    const uniqueIds = new Set(teamUpdates.map(t => t.id));
    if (uniqueIds.size !== teamUpdates.length) {
      return sendError(res, "Duplicate team IDs in payload", 400, 'VALIDATION_ERROR');
    }

    const teamIds = teamUpdates.map(t => t.id);
    const existingTeams = await storage.getTeamsByIds(teamIds);

    if (existingTeams.length !== teamUpdates.length) {
      return sendError(res, "One or more teams not found", 404, 'NOT_FOUND');
    }

    const leagueIds = new Set(existingTeams.map(t => t.leagueId));
    if (leagueIds.size !== 1) {
      return sendError(res, "All teams must belong to the same league", 400, 'VALIDATION_ERROR');
    }

    const leagueId = [...leagueIds][0];
    const league = await storage.getLeague(leagueId);
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }

    const userHasAccess =
      req.user?.role === 'system_admin' ||
      league.organizationId === null ||
      (req.user?.organizationId === league.organizationId);

    if (!userHasAccess) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    await storage.reorderTeams(teamUpdates);
    sendSuccess(res, null);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    sendError(res, 'Failed to reorder teams');
  }
});

router.get("/:id/details", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const team = await storage.getTeam(id);

    if (!team) {
      return sendError(res, "Team not found", 404, 'NOT_FOUND');
    }

    const league = await storage.getLeague(team.leagueId);

    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }

    const userHasAccess =
      req.user?.role === 'system_admin' ||
      league.organizationId === null ||
      (req.user?.organizationId === league.organizationId);

    if (!userHasAccess) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }

    const bowlerLeagues = await storage.getBowlerLeagues({ teamId: id, leagueId: team.leagueId });

    const bowlerIds = [...new Set(bowlerLeagues.map(bl => bl.bowlerId))];
    const rawBowlers = bowlerIds.length > 0
      ? await storage.getBowlersByIds(bowlerIds)
      : [];

    const linkedStatuses = await Promise.all(
      rawBowlers.map(b => storage.isBowlerLinked(b.id))
    );
    const bowlers = rawBowlers.map((b, i) => ({ ...b, hasAccount: linkedStatuses[i] }));

    sendSuccess(res, { team, league, bowlerLeagues, bowlers });
  } catch (error) {
    sendError(res, 'Failed to fetch team details');
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const team = await storage.getTeam(id);
    
    if (!team) {
      return sendError(res, "Team not found", 404, 'NOT_FOUND');
    }
    
    // Get the team's league to check its organization
    const league = await storage.getLeague(team.leagueId);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      req.user?.role === 'system_admin' || 
      league.organizationId === null || 
      (req.user?.organizationId === league.organizationId);
    
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }
    
    sendSuccess(res, team);
  } catch (error) {
    sendError(res, 'Failed to fetch team');
  }
});

router.post("/", async (req, res) => {
  try {
    const team = insertTeamSchema.parse(req.body);
    
    // Check if user has access to the league
    const league = await storage.getLeague(team.leagueId);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      req.user?.role === 'system_admin' || 
      league.organizationId === null || 
      (req.user?.organizationId === league.organizationId);
    
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    const created = await storage.createTeam(team);
    sendSuccess(res, created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    sendError(res, 'Failed to create team');
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get team to verify organization access
    const team = await storage.getTeam(id);
    
    if (!team) {
      return sendError(res, "Team not found", 404, 'NOT_FOUND');
    }
    
    // Check if user has access to the league
    const league = await storage.getLeague(team.leagueId);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      req.user?.role === 'system_admin' || 
      league.organizationId === null || 
      (req.user?.organizationId === league.organizationId);
    
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }
    
    const update = updateTeamSchema.parse(req.body);
    const updated = await storage.updateTeam(id, update);

    if ('active' in update) {
      await storage.renumberActiveTeams(team.leagueId);
    }

    sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    sendError(res, 'Failed to update team');
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get team to verify organization access
    const team = await storage.getTeam(id);
    
    if (!team) {
      return sendError(res, "Team not found", 404, 'NOT_FOUND');
    }
    
    // Check if user has access to the league
    const league = await storage.getLeague(team.leagueId);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      req.user?.role === 'system_admin' || 
      league.organizationId === null || 
      (req.user?.organizationId === league.organizationId);
    
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }
    
    const leagueId = team.leagueId;
    await storage.deleteTeam(id);
    await storage.renumberActiveTeams(leagueId);
    sendSuccess(res, null, 204);
  } catch (error) {
    sendError(res, 'Failed to delete team');
  }
});

export default router;