import { Router } from 'express';
import { storage } from '../storage.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { z } from 'zod';
import { ScoreSchedulerService } from '../services/score-scheduler.js';
import { GoogleDriveService } from '../services/google-drive.js'; // Assuming this import is needed


// Input validation schemas
const getScoresQuerySchema = z.object({
  bowlerId: z.string()
    .transform(val => {
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    })
    .optional(),
  leagueId: z.string()
    .transform(val => {
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    })
    .optional(),
  weekNumber: z.string()
    .transform(val => {
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    })
    .optional(),
  teamId: z.string()
    .transform(val => {
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    })
    .optional(),
});

const router = Router();

// Get historical scores for a team or bowler
router.get('/history', async (req, res) => {
  try {
    console.log('[Scores/History] Processing request with query:', req.query);

    const validationResult = getScoresQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.error('[Scores/History] Validation error:', validationResult.error);
      return sendError(res, 'Invalid query parameters', 400);
    }

    const { bowlerId, leagueId, weekNumber, teamId } = validationResult.data;
    console.log('[Scores/History] Parsed parameters:', { bowlerId, leagueId, weekNumber, teamId });

    // Case 1: Get scores by bowler ID
    if (bowlerId) {
      console.log('[Scores/History] Fetching scores for bowler:', bowlerId);
      const scores = await storage.getBowlerScores(bowlerId);
      console.log('[Scores/History] Found bowler scores:', scores.length);
      return sendSuccess(res, scores);
    }

    // Case 2: Get scores by league ID and week number
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

    // Case 3: Get scores by league ID and team ID
    if (leagueId && teamId) {
      console.log('[Scores/History] Fetching scores for team:', teamId, 'in league:', leagueId);
      const games = await storage.getGames(leagueId);
      console.log('[Scores/History] Found games:', games.length);

      const allScores = [];
      for (const game of games) {
        const gameScores = await storage.getGameScores(game.id);
        // Filter scores for the specific team
        const teamScores = gameScores.filter(score => score.teamId === teamId);
        allScores.push(...teamScores);
      }

      console.log('[Scores/History] Total team scores found:', allScores.length);
      return sendSuccess(res, allScores);
    }

    const errorMessage = 'Invalid query parameters: Either bowlerId, or (leagueId and weekNumber), or (leagueId and teamId) must be provided';
    console.error('[Scores/History] Invalid parameter combination:', { bowlerId, leagueId, weekNumber, teamId });
    return sendError(res, errorMessage, 400);

  } catch (error) {
    console.error('[Scores/History] Error fetching scores:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
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

// Add manual import trigger endpoint
router.post('/import', async (req, res) => {
  try {
    const leagueId = parseInt(req.query.leagueId as string);
    console.log('[Scores/Import] Processing manual import request for league:', leagueId);

    if (isNaN(leagueId)) {
      console.error('[Scores/Import] Invalid league ID provided:', req.query.leagueId);
      return sendError(res, 'Invalid league ID', 400);
    }

    // Initialize score scheduler service
    console.log('[Scores/Import] Initializing ScoreSchedulerService...');
    const scheduler = new ScoreSchedulerService(leagueId);

    // Process scores using the configured folder IDs
    console.log('[Scores/Import] Starting score processing...');
    await scheduler.processNewScores(
      process.env.GOOGLE_DRIVE_SOURCE_FOLDER_ID!,
      process.env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID!
    );
    console.log('[Scores/Import] Score processing completed successfully');

    sendSuccess(res, {
      message: 'Score import process completed successfully',
      leagueId: leagueId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Scores/Import] Error processing scores:', error);
    return sendError(res,
      error instanceof Error ? error.message : 'Failed to import scores',
      500
    );
  }
});

// Add manual listing endpoint for debugging
router.get('/list-source', async (req, res) => {
  try {
    console.log('[Scores/ListSource] Starting file listing test...');

    const sourceFolderId = process.env.GOOGLE_DRIVE_SOURCE_FOLDER_ID;
    if (!sourceFolderId) {
      return sendError(res, 'Source folder ID not configured', 500);
    }

    // Initialize Google Drive service
    console.log('[Scores/ListSource] Initializing GoogleDriveService...');
    const googleDrive = new GoogleDriveService();

    // List files
    console.log('[Scores/ListSource] Attempting to list files...');
    const files = await googleDrive.listNewFiles(sourceFolderId);

    sendSuccess(res, {
      message: 'Successfully listed source folder contents',
      sourceFolder: sourceFolderId,
      fileCount: files.length,
      files: files
    });
  } catch (error) {
    console.error('[Scores/ListSource] Error listing files:', error);
    return sendError(res,
      error instanceof Error ? error.message : 'Failed to list files',
      500
    );
  }
});

export default router;