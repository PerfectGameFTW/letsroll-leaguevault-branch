import { Router } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';
import { z } from 'zod';

const router = Router();

// Input validation schema
const getScoresQuerySchema = z.object({
  gameIds: z.union([
    z.string().transform(val => [Number(val)]),
    z.array(z.string()).transform(val => val.map(Number))
  ])
}).transform(data => ({
  gameIds: data.gameIds.filter(id => !isNaN(id))
}));

// Get scores for specific games
router.get('/', async (req, res) => {
  try {
    console.log('[Scores] Processing request with query:', req.query);

    // Validate input
    const validationResult = getScoresQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.error('[Scores] Validation error:', validationResult.error);
      return sendError(res, 'Invalid game IDs provided', 400);
    }

    const { gameIds } = validationResult.data;
    if (gameIds.length === 0) {
      return sendError(res, 'No valid game IDs provided', 400);
    }

    console.log('[Scores] Fetching scores for games:', gameIds);
    const scores = (await Promise.all(gameIds.map(id => storage.getScores(id)))).flat();
    console.log('[Scores] Retrieved scores:', scores.length);

    sendSuccess(res, scores);
  } catch (error) {
    console.error('[Scores] Error fetching scores:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
  }
});

export default router;