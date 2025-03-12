import { Router } from 'express';
import { storage } from '../storage.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { z } from 'zod';

// Helper function to check league organization access
async function hasAccessToLeague(req: any, leagueId: number): Promise<boolean> {
  // Admin users have access to all leagues
  if (req.user?.isAdmin) {
    return true;
  }
  
  // If user has no organization, they can't access organization-specific data
  if (!req.user?.organizationId) {
    return false;
  }
  
  // Get the league
  const league = await storage.getLeague(leagueId);
  if (!league) {
    return false;
  }
  
  // If league has no organization, it's accessible to all
  if (league.organizationId === null) {
    return true;
  }
  
  // Check if user belongs to the same organization as the league
  return req.user.organizationId === league.organizationId;
}

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
      weekNumber: req.params.weekNumber,
      user: req.user ? { 
        id: req.user.id, 
        isAdmin: req.user.isAdmin,
        organizationId: req.user.organizationId
      } : null
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
    
    // Check organization access for the league
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToLeague(req, leagueId);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this league's scores", 403, 'FORBIDDEN');
      }
    }

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

// Add debug endpoint (admin only)
router.get('/debug-query', (req, res) => {
  // Admin-only endpoint
  if (!req.user?.isAdmin) {
    return sendError(res, "Administrator access required", 403, 'FORBIDDEN');
  }
  
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
    },
    user: req.user ? {
      id: req.user.id,
      isAdmin: req.user.isAdmin,
      organizationId: req.user.organizationId
    } : null
  });

  return sendSuccess(res, {
    query: req.query,
    stringified: JSON.stringify(req.query),
    url: req.url,
    user: req.user ? {
      id: req.user.id,
      isAdmin: req.user.isAdmin,
      organizationId: req.user.organizationId
    } : null
  });
});

// Get historical scores for a team or bowler
router.get('/history', async (req, res) => {
  try {
    console.log('[Scores/History] Processing request with query:', req.query);
    console.log('[Scores/History] User info:', req.user ? {
      id: req.user.id,
      isAdmin: req.user.isAdmin,
      organizationId: req.user.organizationId
    } : null);

    const validationResult = getScoresQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.error('[Scores/History] Validation error:', validationResult.error);
      return sendError(res, 'Invalid query parameters', 400);
    }

    const { leagueId, weekNumber } = validationResult.data;
    console.log('[Scores/History] Parsed parameters:', { leagueId, weekNumber });
    
    // Check organization access for the league
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToLeague(req, leagueId);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this league's scores", 403, 'FORBIDDEN');
      }
    }

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