import { Router } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';
import { z } from 'zod';

const router = Router();

// Input validation schema
const getGamesQuerySchema = z.object({
  leagueId: z.string().transform(val => Number(val))
}).refine(data => !isNaN(data.leagueId), {
  message: "League ID must be a valid number"
});

// Get games for a league
router.get('/', async (req, res) => {
  try {
    console.log('[Games] Processing request with query:', req.query);

    // Validate input
    const validationResult = getGamesQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.log('[Games] Validation error:', validationResult.error);
      return sendError(res, 'Invalid league ID provided', 400);
    }

    const { leagueId } = validationResult.data;
    console.log('[Games] Fetching games for league:', leagueId);

    const games = await storage.getGames(leagueId);
    console.log('[Games] Retrieved games:', games.length);

    sendSuccess(res, games);
  } catch (error) {
    console.error('[Games] Error fetching games:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch games', 500);
  }
});

export default router;