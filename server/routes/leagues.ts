import { Router } from 'express';
import { storage } from '../storage';
import { insertLeagueSchema, partialLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';
import { getOrganizationFilter, filterByOrganization } from '../middleware/organization';

const router = Router();

// Apply organization filtering to all league routes
router.use(filterByOrganization);

router.get("/", async (req: any, res) => {
  try {
    // Get the organization filter from the middleware
    const organizationId = getOrganizationFilter(req);
    
    // Fetch leagues with the organization filter
    const leagues = await storage.getLeagues(organizationId);
    
    // Log for debugging
    console.log(`[Leagues] Fetching leagues with organizationFilter: ${organizationId}`);
    
    sendSuccess(res, leagues);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch leagues');
  }
});

router.get("/:id", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Use the organization middleware's filter logic
    const organizationId = getOrganizationFilter(req);
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      // System admins can access all leagues
      req.user?.isAdmin || 
      // Users can access leagues with no organization
      league.organizationId === null || 
      // Users can access leagues in their own organization
      (organizationId !== null && league.organizationId === organizationId);
    
    if (!userHasAccess) {
      console.log(`[Leagues] Access denied to league ${id} for user with organizationId: ${organizationId}`);
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    sendSuccess(res, league);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch league');
  }
});

router.post("/", async (req: any, res) => {
  try {
    // Parse league data
    const league = insertLeagueSchema.parse({
      ...req.body,
      seasonStart: new Date(req.body.seasonStart),
      seasonEnd: new Date(req.body.seasonEnd)
    });
    
    // Get organization filter from middleware
    const organizationId = getOrganizationFilter(req);
    
    // Non-admin users can only create leagues for their organization
    if (!req.user?.isAdmin) {
      // If user belongs to an organization, set the organization ID
      // This overrides any organizationId provided in the request body
      if (organizationId !== null) {
        league.organizationId = organizationId;
        console.log(`[Leagues] Setting organizationId to ${organizationId} for league creation`);
      } else {
        // Non-admin users without an organization can only create unassigned leagues
        league.organizationId = null;
        console.log(`[Leagues] Setting organizationId to null for league creation (no organization user)`);
      }
    } else if (req.body.organizationId) {
      // Admin users can create leagues for any organization
      console.log(`[Leagues] Admin user creating league for organizationId: ${req.body.organizationId}`);
    } else {
      // Admin creating league with no specific organization
      console.log(`[Leagues] Admin user creating unassigned league`);
    }
    
    const created = await storage.createLeague(league);
    sendSuccess(res, created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, 'Validation error', 400, 'VALIDATION_ERROR', error.format());
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create league');
    }
  }
});

router.patch("/:id", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get the league to verify organization access
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Use the organization middleware's filter logic
    const organizationId = getOrganizationFilter(req);
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      // System admins can access all leagues
      req.user?.isAdmin || 
      // Users can access leagues with no organization
      league.organizationId === null || 
      // Users can access leagues in their own organization
      (organizationId !== null && league.organizationId === organizationId);
    
    if (!userHasAccess) {
      console.log(`[Leagues] Update access denied to league ${id} for user with organizationId: ${organizationId}`);
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
      sendError(res, 'Validation error', 400, 'VALIDATION_ERROR', error.format());
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update league');
    }
  }
});

router.delete("/:id", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get the league to verify organization access
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Use the organization middleware's filter logic
    const organizationId = getOrganizationFilter(req);
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      // System admins can access all leagues
      req.user?.isAdmin || 
      // Users can access leagues with no organization
      league.organizationId === null || 
      // Users can access leagues in their own organization
      (organizationId !== null && league.organizationId === organizationId);
    
    if (!userHasAccess) {
      console.log(`[Leagues] Delete access denied to league ${id} for user with organizationId: ${organizationId}`);
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
