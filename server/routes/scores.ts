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
  leagueId: z.string()
    .transform(val => Number(val))
    .optional(),
  weekNumber: z.string()
    .transform(val => Number(val))
    .optional(),
}).transform(data => ({
  bowlerId: isNaN(data.bowlerId!) ? undefined : data.bowlerId,
  leagueId: isNaN(data.leagueId!) ? undefined : data.leagueId,
  weekNumber: isNaN(data.weekNumber!) ? undefined : data.weekNumber,
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

    const { bowlerId, leagueId, weekNumber } = validationResult.data;
    console.log('[Scores] Parsed query parameters:', { bowlerId, leagueId, weekNumber });

    // If bowlerId is provided, fetch scores for that bowler
    if (bowlerId !== undefined) {
      console.log('[Scores] Fetching scores for bowler:', bowlerId);
      const scores = await storage.getBowlerScores(bowlerId);
      console.log('[Scores] Retrieved bowler scores:', scores.length);
      return sendSuccess(res, scores);
    }

    // If leagueId and weekNumber are provided, fetch all scores for that week
    if (leagueId !== undefined && weekNumber !== undefined) {
      console.log('[Scores] Fetching weekly scores for league:', leagueId, 'week:', weekNumber);

      // First get all games for this week
      const games = await storage.getGames(leagueId, weekNumber);
      console.log('[Scores] Found games:', games.length);

      // Get all scores and bowler details
      const allScores = [];
      const bowlerScores = new Map(); // Map to group scores by bowler

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
          bowlerData.games.set(game.gameNumber, {
            score: score.score,
            handicap: score.handicap,
            total: score.score + score.handicap,
            isVacant: score.isVacant,
            isAbsent: score.isAbsent,
            isSub: score.isSub
          });
          bowlerData.seriesTotal += score.score;
        }
      }

      // Convert Map to array and format the response
      for (const [_, bowlerData] of bowlerScores) {
        const gamesArray = Array.from({ length: 3 }, (_, i) => {
          const gameData = bowlerData.games.get(i + 1);
          return gameData || { score: null, handicap: null, total: null, isVacant: false, isAbsent: false, isSub: false };
        });

        allScores.push({
          bowlerId: bowlerData.bowlerId,
          bowlerName: bowlerData.bowlerName,
          teamId: bowlerData.teamId,
          teamName: bowlerData.teamName,
          date: bowlerData.date,
          weekNumber: bowlerData.weekNumber,
          games: gamesArray,
          seriesTotal: bowlerData.seriesTotal
        });
      }

      // Sort by team name, then bowler name
      allScores.sort((a, b) => {
        const teamCompare = a.teamName.localeCompare(b.teamName);
        if (teamCompare !== 0) return teamCompare;
        return a.bowlerName.localeCompare(b.bowlerName);
      });

      return sendSuccess(res, allScores);
    }

    return sendError(res, 'Either bowlerId or (leagueId and weekNumber) must be provided', 400);
  } catch (error) {
    console.error('[Scores] Error fetching scores:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
  }
});

export default router;