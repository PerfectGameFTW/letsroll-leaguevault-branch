import { Router } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

// Get games for a league
router.get('/', async (req, res) => {
  try {
    const { leagueId } = req.query;
    if (!leagueId || typeof leagueId !== 'string') {
      return sendError(res, 'League ID is required', 400);
    }

    const id = Number(leagueId);
    if (isNaN(id)) {
      return sendError(res, 'Invalid league ID provided', 400);
    }

    const games = await storage.getGames(id);
    sendSuccess(res, games);
  } catch (error) {
    console.error('[Games] Error fetching games:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch games', 500);
  }
});

export default router;