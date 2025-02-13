import { Router } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

// Get scores for specific games
router.get('/', async (req, res) => {
  try {
    const { gameIds } = req.query;
    if (!gameIds) {
      return sendError(res, 'Game IDs are required', 400);
    }

    // Handle both array and single value cases
    const ids = Array.isArray(gameIds) 
      ? gameIds.map(id => Number(id))
      : typeof gameIds === 'string' 
        ? [Number(gameIds)]
        : [];

    // Validate that we have valid numbers
    if (ids.some(isNaN)) {
      return sendError(res, 'Invalid game IDs provided', 400);
    }

    // Get scores for each game ID and combine results
    const scores = (await Promise.all(ids.map(id => storage.getScores(id)))).flat();
    sendSuccess(res, scores);
  } catch (error) {
    console.error('[Scores] Error fetching scores:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
  }
});

export default router;