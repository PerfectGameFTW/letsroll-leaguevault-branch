import { Router } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';
import { z } from 'zod';

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

    // Validate input
    const validationResult = getGamesQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.log('[Games] Validation error:', validationResult.error);
      return sendError(res, 'Invalid or missing parameters', 400);
    }

    const { leagueId, weekNumber } = validationResult.data;
    console.log('[Games] Fetching games for league:', leagueId, 'week:', weekNumber);

    const games = await storage.getGames(leagueId, weekNumber);
    console.log('[Games] Retrieved games:', games.length);

    sendSuccess(res, games);
  } catch (error) {
    console.error('[Games] Error fetching games:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch games', 500);
  }
});

export default router;