import { Router } from 'express';
import { storage } from '../storage.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { z } from 'zod';

const router = Router();

// Input validation schema
const getScoresQuerySchema = z.object({
  gameIds: z.union([
    z.string().transform(val => [Number(val)]),
    z.array(z.string()).transform(val => val.map(Number))
  ]).optional(),
  bowlerId: z.string().transform(Number).optional(),
}).transform(data => ({
  gameIds: data.gameIds?.filter(id => !isNaN(id)) ?? [],
  bowlerId: isNaN(data.bowlerId) ? undefined : data.bowlerId
}));

// Get scores
router.get('/', async (req, res) => {
  try {
    console.log('[Scores] Processing request with query:', req.query);

    // Validate input
    const validationResult = getScoresQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.error('[Scores] Validation error:', validationResult.error);
      return sendError(res, 'Invalid query parameters', 400);
    }

    const { gameIds, bowlerId } = validationResult.data;
    console.log('[Scores] Parsed query parameters:', { gameIds, bowlerId });

    // If bowlerId is provided, fetch scores for that bowler
    if (bowlerId !== undefined) {
      console.log('[Scores] Fetching scores for bowler:', bowlerId);
      const scores = await storage.getBowlerScores(bowlerId);
      console.log('[Scores] Retrieved bowler scores:', scores.length);
      console.log('[Scores] Sample score:', scores[0]);
      return sendSuccess(res, scores);
    }

    // Otherwise, fetch scores for specific games
    if (gameIds.length > 0) {
      console.log('[Scores] Fetching scores for games:', gameIds);
      const scores = (await Promise.all(gameIds.map(id => storage.getScores(id)))).flat();
      console.log('[Scores] Retrieved game scores:', scores.length);
      return sendSuccess(res, scores);
    }

    return sendError(res, 'No valid query parameters provided', 400);
  } catch (error) {
    console.error('[Scores] Error fetching scores:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
  }
});

export default router;