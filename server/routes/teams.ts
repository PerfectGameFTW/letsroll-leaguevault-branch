import { Router } from 'express';
import { storage } from '../storage';
import { insertTeamSchema, updateTeamSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api.js';

const router = Router();

router.get("/", async (req, res) => {
  try {
    const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
    
    // If a league ID is provided, we need to check if the user has access to that league
    let teams = [];
    
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
      } else {
        // Everyone else (including affiliated system admins): scope to their org
        const leagues = scopedOrgId !== null
          ? await storage.getLeagues(scopedOrgId)
          : await storage.getAllLeagues();
        const teamPromises = leagues.map(league => storage.getTeams(league.id));
        const teamsArrays = await Promise.all(teamPromises);
        teams = teamsArrays.flat();
      }
    }
    
    sendSuccess(res, teams);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch teams');
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
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch team');
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
      sendError(res, error.errors.map(e => e.message).join(', '), 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create team');
    }
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
    sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error.errors.map(e => e.message).join(', '), 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update team');
    }
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
    
    await storage.deleteTeam(id);
    sendSuccess(res, null, 204);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to delete team');
  }
});

export default router;