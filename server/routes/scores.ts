import { Router } from 'express';
import { storage } from '../storage.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { z } from 'zod';

const router = Router();

// Input validation schema
const getScoresQuerySchema = z.object({
  bowlerId: z.string()
    .transform(val => Number(val))
    .optional(),
  gameIds: z.union([
    z.string().transform(val => [Number(val)]),
    z.array(z.string()).transform(val => val.map(Number))
  ]).optional(),
}).transform(data => ({
  bowlerId: isNaN(data.bowlerId!) ? undefined : data.bowlerId,
  gameIds: data.gameIds?.filter(id => !isNaN(id)) ?? []
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

    const { bowlerId, gameIds } = validationResult.data;
    console.log('[Scores] Parsed query parameters:', { bowlerId, gameIds });

    // If bowlerId is provided, fetch scores for that bowler
    if (bowlerId !== undefined) {
      console.log('[Scores] Fetching scores for bowler:', bowlerId);
      const scores = await storage.getBowlerScores(bowlerId);
      console.log('[Scores] Retrieved bowler scores:', scores.length);
      return sendSuccess(res, scores);
    }

    // Otherwise, fetch scores for specific games
    if (gameIds.length > 0) {
      console.log('[Scores] Fetching scores for games:', gameIds);
      const scores = await Promise.all(gameIds.map(id => storage.getGameScores(id)));
      const flattenedScores = scores.flat();
      console.log('[Scores] Retrieved game scores:', flattenedScores.length);
      return sendSuccess(res, flattenedScores);
    }

    return sendError(res, 'Either bowlerId or gameIds must be provided', 400);
  } catch (error) {
    console.error('[Scores] Error fetching scores:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
  }
});

export default router;