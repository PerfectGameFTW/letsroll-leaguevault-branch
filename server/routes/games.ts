import { Router } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';
import { z } from 'zod';

// Helper function to check league organization access
async function hasAccessToLeague(req: any, leagueId: number): Promise<boolean> {
  // Admin users have access to all leagues
  if (req.user?.isAdmin) {
    return true;
  }
  
  // If user has no organization, they can't access organization-specific data
  if (!req.user?.organizationId) {
    return false;
  }
  
  // Get the league
  const league = await storage.getLeague(leagueId);
  if (!league) {
    return false;
  }
  
  // If league has no organization, it's accessible to all
  if (league.organizationId === null) {
    return true;
  }
  
  // Check if user belongs to the same organization as the league
  return req.user.organizationId === league.organizationId;
}

const router = Router();

// Input validation schema - make leagueId required and ensure it's properly transformed
const getGamesQuerySchema = z.object({
  leagueId: z.coerce.number({
    required_error: "League ID is required",
    invalid_type_error: "League ID must be a number"
  }),
  weekNumber: z.coerce.number().optional()
});

// Get games for a league
router.get('/', async (req, res) => {
  try {
    console.log('[Games] Processing request with query:', req.query);
    console.log('[Games] User info:', req.user ? {
      id: req.user.id,
      isAdmin: req.user.isAdmin,
      organizationId: req.user.organizationId
    } : null);

    // Validate input
    const validationResult = getGamesQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.log('[Games] Validation error:', validationResult.error);
      return sendError(res, 'Invalid or missing parameters', 400);
    }

    const { leagueId, weekNumber } = validationResult.data;
    console.log('[Games] Fetching games for league:', leagueId, 'week:', weekNumber);
    
    // Check organization access for the league
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToLeague(req, leagueId);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this league's games", 403, 'FORBIDDEN');
      }
    }

    const games = await storage.getGames(leagueId, weekNumber);
    console.log('[Games] Retrieved games:', games.length);

    sendSuccess(res, games);
  } catch (error) {
    console.error('[Games] Error fetching games:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch games', 500);
  }
});

export default router;