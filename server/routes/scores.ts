import { Router } from 'express';
import { storage } from '../storage.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { z } from 'zod';

const router = Router();

// Input validation schemas
const getScoresQuerySchema = z.object({
  bowlerId: z.string()
    .transform(val => Number(val))
    .optional(),
  leagueId: z.string()
    .transform(val => Number(val))
    .optional(),
  weekNumber: z.string()
    .transform(val => Number(val))
    .optional(),
  teamId: z.string()
    .transform(val => Number(val))
    .optional(),
}).transform(data => ({
  bowlerId: isNaN(data.bowlerId!) ? undefined : data.bowlerId,
  leagueId: isNaN(data.leagueId!) ? undefined : data.leagueId,
  weekNumber: isNaN(data.weekNumber!) ? undefined : data.weekNumber,
  teamId: isNaN(data.teamId!) ? undefined : data.teamId,
}));

// Get historical scores for a team or bowler
router.get('/history', async (req, res) => {
  try {
    console.log('[Scores/History] Processing request with query:', req.query);

    const validationResult = getScoresQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.error('[Scores/History] Validation error:', validationResult.error);
      return sendError(res, 'Invalid query parameters', 400);
    }

    const { bowlerId, leagueId, teamId } = validationResult.data;

    if (bowlerId) {
      console.log('[Scores/History] Fetching historical scores for bowler:', bowlerId);
      const scores = await storage.getBowlerScores(bowlerId);
      console.log('[Scores/History] Total scores found:', scores.length);

      // Filter and validate scores
      const validScores = scores.filter(s =>
        !s.isAbsent &&
        !s.isVacant &&
        typeof s.score === 'number' &&
        s.score > 0
      );
      console.log('[Scores/History] Valid scores count:', validScores.length);

      // Calculate total pinfall from valid scores
      const totalPinfall = validScores.reduce((sum, s) => {
        console.log('[Scores/History] Processing score:', {
          score: s.score,
          isValid: typeof s.score === 'number' && s.score > 0
        });
        return sum + (typeof s.score === 'number' ? s.score : 0);
      }, 0);
      console.log('[Scores/History] Total pinfall:', totalPinfall);

      // Calculate average from valid games only
      const average = validScores.length > 0 ? Math.round(totalPinfall / validScores.length) : 0;
      console.log('[Scores/History] Final calculation:', {
        totalPins: totalPinfall,
        gamesPlayed: validScores.length,
        average: average
      });

      return sendSuccess(res, scores);
    } else if (teamId && leagueId) {
      console.log('[Scores/History] Fetching historical scores for team:', teamId, 'in league:', leagueId);

      // Get all games for this league
      const games = await storage.getGames(leagueId);
      console.log('[Scores/History] Found games:', games.length);

      const allScores = [];
      for (const game of games) {
        const gameScores = await storage.getScores(game.id, teamId);
        allScores.push(...gameScores);
      }

      // Filter and validate team scores
      const validTeamScores = allScores.filter(s =>
        !s.isAbsent &&
        !s.isVacant &&
        typeof s.score === 'number' &&
        s.score > 0
      );

      console.log('[Scores/History] Team scores statistics:', {
        totalScores: allScores.length,
        validScores: validTeamScores.length,
        totalPinfall: validTeamScores.reduce((sum, s) => sum + (s.score || 0), 0)
      });

      return sendSuccess(res, allScores);
    }

    return sendError(res, 'Either bowlerId or (teamId and leagueId) must be provided', 400);
  } catch (error) {
    console.error('[Scores/History] Error fetching historical scores:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to fetch historical scores', 500);
  }
});

// Get scores for current week
router.get('/', async (req, res) => {
  try {
    console.log('[Scores] Processing request with query:', req.query);

    const validationResult = getScoresQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.error('[Scores] Validation error:', validationResult.error);
      return sendError(res, 'Invalid query parameters', 400);
    }

    const { bowlerId, leagueId, weekNumber } = validationResult.data;
    console.log('[Scores] Parsed query parameters:', { bowlerId, leagueId, weekNumber });

    if (bowlerId !== undefined) {
      console.log('[Scores] Fetching scores for bowler:', bowlerId);
      const scores = await storage.getBowlerScores(bowlerId);

      // Log bowler's score statistics
      const validScores = scores.filter(s => !s.isAbsent && !s.isVacant && s.score !== null);
      console.log('[Scores] Total bowler scores:', scores.length);
      console.log('[Scores] Valid bowler scores:', validScores.length);
      console.log('[Scores] Bowler total pinfall:', validScores.reduce((sum, s) => sum + (s.score || 0), 0));

      return sendSuccess(res, scores);
    }

    if (leagueId !== undefined && weekNumber !== undefined) {
      console.log('[Scores] Fetching weekly scores for league:', leagueId, 'week:', weekNumber);
      const games = await storage.getGames(leagueId, weekNumber);
      console.log('[Scores] Found games:', games.length);

      const allScores = [];
      const bowlerScores = new Map();

      for (const game of games) {
        const gameScores = await storage.getGameScores(game.id);

        for (const score of gameScores) {
          const bowler = await storage.getBowler(score.bowlerId);
          const team = await storage.getTeam(score.teamId);

          if (!bowler || !team) continue;

          const bowlerKey = `${score.bowlerId}-${team.id}`;
          if (!bowlerScores.has(bowlerKey)) {
            bowlerScores.set(bowlerKey, {
              bowlerId: score.bowlerId,
              bowlerName: bowler.name,
              teamId: team.id,
              teamName: team.name,
              date: game.date,
              weekNumber: game.weekNumber,
              games: new Map(),
              seriesTotal: 0
            });
          }

          const bowlerData = bowlerScores.get(bowlerKey);
          if (!score.isAbsent && !score.isVacant && score.score !== null) {
            bowlerData.games.set(game.gameNumber, {
              score: score.score,
              handicap: score.handicap,
              total: score.score + (score.handicap || 0),
              isVacant: score.isVacant,
              isAbsent: score.isAbsent,
              isSub: score.isSub
            });
            bowlerData.seriesTotal += score.score;
          }
        }
      }

      const formattedScores = Array.from(bowlerScores.values()).map(bowlerData => ({
        ...bowlerData,
        games: Array.from({ length: 3 }, (_, i) => {
          const gameData = bowlerData.games.get(i + 1);
          return gameData || { score: null, handicap: null, total: null, isVacant: false, isAbsent: false, isSub: false };
        })
      }));

      console.log('[Scores] Processed scores for', formattedScores.length, 'bowlers');

      return sendSuccess(res, formattedScores);
    }

    return sendError(res, 'Either bowlerId or (leagueId and weekNumber) must be provided', 400);
  } catch (error) {
    console.error('[Scores] Error fetching scores:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
  }
});

export default router;