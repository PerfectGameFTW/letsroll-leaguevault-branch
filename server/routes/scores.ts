import { Router } from 'express';
import { storage } from '../storage.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { z } from 'zod';

// Validation schema for league and week params
const getLeagueScoresSchema = z.object({
  leagueId: z.string()
    .min(1, "League ID is required")
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), {
      message: "League ID must be a valid number"
    }),
  weekNumber: z.string()
    .min(1, "Week number is required")
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), {
      message: "Week number must be a valid number"
    })
});

const router = Router();

// Get scores for a specific league and week
router.get('/league/:leagueId/week/:weekNumber', async (req, res) => {
  try {
    console.log('[Scores/League] Raw parameters:', {
      leagueId: req.params.leagueId,
      weekNumber: req.params.weekNumber
    });

    const validationResult = getLeagueScoresSchema.safeParse({
      leagueId: req.params.leagueId,
      weekNumber: req.params.weekNumber
    });

    if (!validationResult.success) {
      console.error('[Scores/League] Validation error:', validationResult.error.errors);
      return sendError(res, validationResult.error.errors.map(e => e.message).join(', '), 400);
    }

    const { leagueId, weekNumber } = validationResult.data;
    console.log('[Scores/League] Validated parameters:', { leagueId, weekNumber });

    // Get scores using storage method
    const scores = await storage.getScoresByLeagueAndWeek(leagueId, weekNumber);
    console.log('[Scores/League] Found scores:', scores.length);

    return sendSuccess(res, scores);
  } catch (error) {
    console.error('[Scores/League] Error fetching scores:', error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
  }
});

// Add debug endpoint
router.get('/debug-query', (req, res) => {
  console.log('[Scores/Debug] Raw query:', {
    raw: req.query,
    stringified: JSON.stringify(req.query),
    types: {
      leagueId: typeof req.query.leagueId,
      weekNumber: typeof req.query.weekNumber
    },
    values: {
      leagueId: req.query.leagueId,
      weekNumber: req.query.weekNumber
    }
  });

  return sendSuccess(res, {
    query: req.query,
    stringified: JSON.stringify(req.query),
    url: req.url
  });
});

// Get historical scores for a team or bowler
router.get('/history', async (req, res) => {
  try {
    console.log('[Scores/History] Processing request with query:', req.query);

    const validationResult = getScoresQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.error('[Scores/History] Validation error:', validationResult.error);
      return sendError(res, 'Invalid query parameters', 400);
    }

    const { leagueId, weekNumber } = validationResult.data;
    console.log('[Scores/History] Parsed parameters:', { leagueId, weekNumber });

    if (leagueId && weekNumber) {
      console.log('[Scores/History] Fetching scores for league:', leagueId, 'week:', weekNumber);
      const games = await storage.getGames(leagueId, weekNumber);
      console.log('[Scores/History] Found games:', games.length);

      const allScores = [];
      for (const game of games) {
        const gameScores = await storage.getGameScores(game.id);
        allScores.push(...gameScores);
      }

      console.log('[Scores/History] Total scores found:', allScores.length);
      return sendSuccess(res, allScores);
    }

    const errorMessage = 'Invalid query parameters: leagueId and weekNumber must be provided';
    console.error('[Scores/History] Invalid parameter combination:', { leagueId, weekNumber });
    return sendError(res, errorMessage, 400);

  } catch (error) {
    console.error('[Scores/History] Error fetching scores:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
  }
});

// Simplified validation schema
const getScoresQuerySchema = z.object({
  leagueId: z.string()
    .min(1, "League ID is required")
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), {
      message: "League ID must be a valid number"
    }),
  weekNumber: z.string()
    .min(1, "Week number is required")
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), {
      message: "Week number must be a valid number"
    })
});

export default router;