import { Router } from 'express';
import { storage } from '../storage';
import { insertLeagueSchema, partialLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

router.get("/", async (req, res) => {
  try {
    // Filter leagues by user's organization if they're not an admin
    let leagues;
    if (req.user?.isAdmin) {
      // Admins can see all leagues
      leagues = await storage.getLeagues();
    } else if (req.user?.organizationId) {
      // Organization users can only see their org's leagues
      leagues = await storage.getLeagues(req.user.organizationId);
    } else {
      // Regular users can only see leagues not assigned to any organization
      leagues = await storage.getLeagues(null);
    }
    
    sendSuccess(res, leagues);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch leagues');
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      req.user?.isAdmin || 
      league.organizationId === null || 
      (req.user?.organizationId === league.organizationId);
    
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    sendSuccess(res, league);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch league');
  }
});

router.post("/", async (req, res) => {
  try {
    // Parse league data
    const league = insertLeagueSchema.parse({
      ...req.body,
      seasonStart: new Date(req.body.seasonStart),
      seasonEnd: new Date(req.body.seasonEnd)
    });
    
    // Non-admin users can only create leagues for their organization
    if (!req.user?.isAdmin) {
      // If user belongs to an organization, set the organization ID
      if (req.user?.organizationId) {
        league.organizationId = req.user.organizationId;
      } else {
        // Non-admin users without an organization can only create unassigned leagues
        league.organizationId = null;
      }
    }
    
    // Admin users can create leagues for any organization
    // The organization ID is already set in the league object from the request body
    
    const created = await storage.createLeague(league);
    sendSuccess(res, created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create league');
    }
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get the league to verify organization access
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      req.user?.isAdmin || 
      league.organizationId === null || 
      (req.user?.organizationId === league.organizationId);
    
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    // Non-admin users cannot change the organization of a league
    if (!req.user?.isAdmin && req.body.organizationId !== undefined) {
      return sendError(res, "You don't have permission to change the organization of this league", 403, 'FORBIDDEN');
    }
    
    const update = partialLeagueSchema.parse({
      ...req.body,
      seasonStart: req.body.seasonStart ? new Date(req.body.seasonStart) : undefined,
      seasonEnd: req.body.seasonEnd ? new Date(req.body.seasonEnd) : undefined
    });
    
    const updated = await storage.updateLeague(id, update);
    sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update league');
    }
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get the league to verify organization access
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      req.user?.isAdmin || 
      league.organizationId === null || 
      (req.user?.organizationId === league.organizationId);
    
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    const teams = await storage.getTeams(id);

    for (const team of teams) {
      const teamBowlers = await storage.getBowlers(team.id);
      for (const bowler of teamBowlers) {
        await storage.updateBowler(bowler.id, { active: false, order: 0 });
      }
      await storage.deleteTeam(team.id);
    }

    await storage.deleteLeague(id);
    sendSuccess(res, null, 204);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to delete league');
  }
});

export default router;
