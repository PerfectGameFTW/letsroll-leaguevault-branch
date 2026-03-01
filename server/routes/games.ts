import { Router } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';
import { z } from 'zod';
import { hasAccessToLeague } from '../utils/access-control.js';

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
    const validationResult = getGamesQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      return sendError(res, 'Invalid or missing parameters', 400);
    }

    const { leagueId, weekNumber } = validationResult.data;
    
    // Check organization access for the league
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToLeague(req, leagueId);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this league's games", 403, 'FORBIDDEN');
      }
    }

    const games = await storage.getGames(leagueId, weekNumber);
    sendSuccess(res, games);
  } catch (error) {
    console.error('[Games] Error fetching games:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch games', 500);
  }
});

export default router;