import { Router } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError, handleZodError } from '../utils/api.js';
import { z } from 'zod';
import { hasAccessToLeague } from '../utils/access-control.js';
import { createLogger } from '../logger';

const log = createLogger("Scores");

const getLeagueScoresSchema = z.object({
  leagueId: z.string()
    .min(1, "League ID is required")
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), { message: "League ID must be a valid number" }),
  weekNumber: z.string()
    .min(1, "Week number is required")
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val), { message: "Week number must be a valid number" })
});

const getScoresQuerySchema = z.object({
  leagueId: z.string().transform(Number).optional(),
  weekNumber: z.string().transform(Number).optional(),
});

const router = Router();

router.get('/league/:leagueId/week/:weekNumber', async (req, res) => {
  try {
    const validationResult = getLeagueScoresSchema.safeParse({
      leagueId: req.params.leagueId,
      weekNumber: req.params.weekNumber
    });

    if (!validationResult.success) {
      return handleZodError(res, validationResult.error);
    }

    const { leagueId, weekNumber } = validationResult.data;

    if (req.user?.role !== 'system_admin') {
      const hasAccess = await hasAccessToLeague(req, leagueId);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this league's scores", 403, 'FORBIDDEN');
      }
    }

    const scores = await storage.getScoresByLeagueAndWeek(leagueId, weekNumber);
    return sendSuccess(res, scores);
  } catch (error) {
    log.error('Error fetching scores:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
  }
});

router.get('/history', async (req, res) => {
  try {
    const validationResult = getScoresQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      return handleZodError(res, validationResult.error);
    }

    const { leagueId, weekNumber } = validationResult.data;

    if (leagueId && req.user?.role !== 'system_admin') {
      const hasAccess = await hasAccessToLeague(req, leagueId);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this league's scores", 403, 'FORBIDDEN');
      }
    }

    if (leagueId && weekNumber) {
      const games = await storage.getGames(leagueId, weekNumber);
      const gameIds = games.map(g => g.id);
      const allScores = await storage.getScoresByGameIds(gameIds);
      return sendSuccess(res, allScores);
    }

    return sendError(res, 'leagueId and weekNumber must be provided', 400);
  } catch (error) {
    log.error('Error fetching scores:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
  }
});

router.post('/batch', async (req, res) => {
  try {
    const { scores } = req.body;
    if (!Array.isArray(scores)) {
      return sendError(res, 'Scores must be an array', 400);
    }

    const results = [];
    for (const score of scores) {
      const created = await storage.createScore(score);
      results.push(created);
    }

    return sendSuccess(res, results, 201);
  } catch (error) {
    log.error('Error creating scores:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to create scores', 500);
  }
});

export default router;
