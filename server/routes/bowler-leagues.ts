import { Router } from 'express';
import { storage } from '../storage';
import { insertBowlerLeagueSchema, partialBowlerLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

// Helper function to check if user has access to a league's organization
async function hasAccessToLeague(req: any, leagueId: number): Promise<boolean> {
  const league = await storage.getLeague(leagueId);
  
  if (!league) {
    return false;
  }
  
  return (
    req.user?.isAdmin || 
    league.organizationId === null || 
    (req.user?.organizationId === league.organizationId)
  );
}

// Helper function to check if user has access to a team's league organization
async function hasAccessToTeam(req: any, teamId: number): Promise<boolean> {
  const team = await storage.getTeam(teamId);
  
  if (!team) {
    return false;
  }
  
  return hasAccessToLeague(req, team.leagueId);
}

// Helper function to check if user has access to a bowler's teams/leagues
async function hasAccessToBowler(req: any, bowlerId: number): Promise<boolean> {
  // If user is admin, they have access to all bowlers
  if (req.user?.isAdmin) {
    return true;
  }
  
  // Get the bowler's leagues
  const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId });
  
  // If bowler isn't in any leagues, they're considered public for now
  if (bowlerLeagues.length === 0) {
    return true;
  }
  
  // Check if the user has access to any of the bowler's leagues
  for (const bl of bowlerLeagues) {
    if (await hasAccessToLeague(req, bl.leagueId)) {
      return true;
    }
  }
  
  return false;
}

router.get("/", async (req, res) => {
  try {
    const { bowlerId, leagueId, teamId } = req.query;
    console.log('[BowlerLeagues] Fetching with params:', { bowlerId, leagueId, teamId });

    const filters = {
      bowlerId: bowlerId ? parseInt(bowlerId as string) : undefined,
      leagueId: leagueId ? parseInt(leagueId as string) : undefined,
      teamId: teamId ? parseInt(teamId as string) : undefined
    };

    // Validate that all provided IDs are valid numbers
    if ((bowlerId && isNaN(filters.bowlerId!)) || 
        (leagueId && isNaN(filters.leagueId!)) || 
        (teamId && isNaN(filters.teamId!))) {
      return sendError(res, "Invalid ID parameters provided", 400);
    }

    // Check organization access
    if (filters.leagueId && !(await hasAccessToLeague(req, filters.leagueId))) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    if (filters.teamId && !(await hasAccessToTeam(req, filters.teamId))) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }
    
    if (filters.bowlerId && !(await hasAccessToBowler(req, filters.bowlerId))) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    // Get bowler leagues
    let bowlerLeagues = await storage.getBowlerLeagues(filters);

    // If no specific filters were provided, filter by organization
    if (!filters.bowlerId && !filters.leagueId && !filters.teamId && !req.user?.isAdmin) {
      // Filter bowler leagues by organization
      const leagueIds = new Set<number>();
      for (const bl of bowlerLeagues) {
        leagueIds.add(bl.leagueId);
      }

      // Check which leagues the user has access to
      const accessibleLeagueIds = new Set<number>();
      for (const leagueId of leagueIds) {
        if (await hasAccessToLeague(req, leagueId)) {
          accessibleLeagueIds.add(leagueId);
        }
      }

      // Only include bowler leagues from accessible leagues
      bowlerLeagues = bowlerLeagues.filter(bl => accessibleLeagueIds.has(bl.leagueId));
    }

    console.log(`[BowlerLeagues] Found ${bowlerLeagues.length} bowler leagues for filters:`, filters);
    sendSuccess(res, bowlerLeagues);
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowler leagues');
  }
});

router.post("/", async (req, res) => {
  try {
    console.log('[BowlerLeagues] Creating new bowler league with body:', req.body);
    const data = insertBowlerLeagueSchema.parse(req.body);

    // Check if the user has access to the league
    if (!(await hasAccessToLeague(req, data.leagueId))) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    // Check if the user has access to the team
    if (!(await hasAccessToTeam(req, data.teamId))) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }

    // Check if the user has access to the bowler
    if (!(await hasAccessToBowler(req, data.bowlerId))) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const existing = await storage.getBowlerLeagues({
      bowlerId: data.bowlerId,
      leagueId: data.leagueId
    });

    if (existing.length > 0) {
      return sendError(res, "Bowler is already in this league", 400);
    }

    const created = await storage.createBowlerLeague(data);
    console.log('[BowlerLeagues] Created bowler league:', created);
    sendSuccess(res, created, 201);
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    if (error instanceof z.ZodError) {
      sendError(res, "Validation error", 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create bowler league');
    }
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid ID provided");
    }

    // Get the bowler league to verify organization access
    const bowlerLeague = await storage.getBowlerLeague(id);
    if (!bowlerLeague) {
      return sendError(res, "Bowler league not found", 404);
    }

    // Check if user has access to the league
    if (!(await hasAccessToLeague(req, bowlerLeague.leagueId))) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    // Check if user has access to the team
    if (!(await hasAccessToTeam(req, bowlerLeague.teamId))) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }

    // Check if user has access to the bowler
    if (!(await hasAccessToBowler(req, bowlerLeague.bowlerId))) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const update = partialBowlerLeagueSchema.parse(req.body);
    console.log(`[BowlerLeagues] Updating bowler league ${id}:`, update);

    // If updating team, verify access to the new team
    if (update.teamId && !(await hasAccessToTeam(req, update.teamId))) {
      return sendError(res, "You don't have access to the target team", 403, 'FORBIDDEN');
    }

    const updated = await storage.updateBowlerLeague(id, update);
    if (!updated) {
      return sendError(res, "Bowler league not found", 404);
    }
    sendSuccess(res, updated);
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    if (error instanceof z.ZodError) {
      sendError(res, "Validation error", 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update bowler league');
    }
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid ID provided", 400);
    }

    // Get the bowler league to verify organization access
    const bowlerLeague = await storage.getBowlerLeague(id);
    if (!bowlerLeague) {
      return sendError(res, "Bowler league not found", 404);
    }

    // Check if user has access to the league
    if (!(await hasAccessToLeague(req, bowlerLeague.leagueId))) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    // Check if user has access to the team
    if (!(await hasAccessToTeam(req, bowlerLeague.teamId))) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }

    // Check if user has access to the bowler
    if (!(await hasAccessToBowler(req, bowlerLeague.bowlerId))) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    console.log(`[BowlerLeagues] Deleting bowler league ${id}`);
    const deleted = await storage.deleteBowlerLeague(id);

    if (!deleted) {
      return sendError(res, "Bowler league not found", 404);
    }

    console.log(`[BowlerLeagues] Successfully deleted bowler league ${id}`);
    sendSuccess(res, { message: "Bowler league deleted successfully" }, 200);
  } catch (error) {
    console.error('[BowlerLeagues] Error deleting bowler league:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to delete bowler league');
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

    // Get the bowler league to verify organization access
    const bowlerLeague = await storage.getBowlerLeague(id);
    if (!bowlerLeague) {
      return sendError(res, "Bowler league not found", 404);
    }

    // Check if user has access to the league
    if (!(await hasAccessToLeague(req, bowlerLeague.leagueId))) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    // Check if user has access to the team
    if (!(await hasAccessToTeam(req, bowlerLeague.teamId))) {
      return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
    }

    const updated = await storage.updateBowlerLeagueOrder(id, newOrder);
    sendSuccess(res, updated);
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to update bowler league order');
  }
});

export default router;