import { Router } from 'express';
import { storage } from '../storage.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { z } from 'zod';
import { ScoreImportService, ScoreImportError } from '../services/score-import.js';
import { GoogleDriveService } from '../services/google-drive.js';

// Update validation schema at the top of the file
const getScoresQuerySchema = z.object({
  leagueId: z.string().transform((val) => parseInt(val, 10)).pipe(
    z.number().int().positive({
      message: "League ID must be a positive number"
    })
  ),
  weekNumber: z.string().transform((val) => parseInt(val, 10)).pipe(
    z.number().int().positive({
      message: "Week number must be a positive number"
    })
  )
});

const router = Router();

// Get scores for a specific league and week
router.get('/', async (req, res) => {
  try {
    console.log('[Scores] Processing request with query:', req.query);

    const validationResult = getScoresQuerySchema.safeParse(req.query);
    if (!validationResult.success) {
      console.error('[Scores] Validation error:', validationResult.error.format());
      return sendError(res, 'Invalid query parameters: ' + validationResult.error.errors.map(e => e.message).join(', '), 400);
    }

    const { leagueId, weekNumber } = validationResult.data;
    console.log('[Scores] Parsed query parameters:', { leagueId, weekNumber });

    // Get scores for the specified league and week
    const scores = await storage.getScoresByLeagueAndWeek(leagueId, weekNumber);
    console.log('[Scores] Found scores:', scores.length);

    // Group scores by game, then by team
    const groupedScores = scores.reduce((acc, score) => {
      const gameNumber = score.game.gameNumber;
      const teamNumber = score.team.number;

      if (!acc[gameNumber]) {
        acc[gameNumber] = {};
      }
      if (!acc[gameNumber][teamNumber]) {
        acc[gameNumber][teamNumber] = {
          teamId: score.team.id,
          teamName: score.team.name,
          teamNumber: score.team.number,
          laneNumber: score.laneNumber,
          bowlers: []
        };
      }

      acc[gameNumber][teamNumber].bowlers.push({
        bowlerId: score.bowlerId,
        bowlerName: score.bowler.name,
        score: score.score,
        handicap: score.handicap,
        isVacant: score.isVacant,
        isAbsent: score.isAbsent,
        isSub: score.isSub,
        position: score.position
      });

      return acc;
    }, {});

    // Convert to array format and sort teams
    const formattedGames = Object.entries(groupedScores).map(([gameNumber, teams]) => {
      const teamPairs = Object.values(teams);
      // Sort teams by lane number
      teamPairs.sort((a, b) => a.laneNumber - b.laneNumber);

      // Sort bowlers by position within each team
      teamPairs.forEach(team => {
        team.bowlers.sort((a, b) => a.position - b.position);
      });

      return {
        gameNumber: parseInt(gameNumber),
        teams: teamPairs
      };
    });

    // Sort games by game number
    formattedGames.sort((a, b) => a.gameNumber - b.gameNumber);

    return sendSuccess(res, formattedGames);
  } catch (error) {
    console.error('[Scores] Error fetching scores:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to fetch scores', 500);
  }
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

// Enhanced import route to use Google Drive
router.post('/import', async (req, res) => {
  try {
    const leagueId = parseInt(req.query.leagueId as string);
    console.log('[Scores/Import] Processing import request for league:', leagueId);

    if (isNaN(leagueId)) {
      console.error('[Scores/Import] Invalid league ID provided:', req.query.leagueId);
      return sendError(res, 'Invalid league ID', 400);
    }

    // Check if league exists
    const league = await storage.getLeague(leagueId);
    if (!league) {
      console.error('[Scores/Import] League not found:', leagueId);
      return sendError(res, 'League not found', 404);
    }

    // Initialize Google Drive service
    console.log('[Scores/Import] Initializing GoogleDriveService...');
    const googleDrive = new GoogleDriveService();
    const sourceFolderId = process.env.GOOGLE_DRIVE_SOURCE_FOLDER_ID;

    if (!sourceFolderId) {
      console.error('[Scores/Import] Source folder ID not configured');
      return sendError(res, 'Source folder ID not configured', 500);
    }

    // List and get the latest file
    console.log('[Scores/Import] Fetching files from Google Drive folder:', sourceFolderId);
    const files = await googleDrive.listNewFiles(sourceFolderId);

    if (files.length === 0) {
      console.error('[Scores/Import] No files found in source folder');
      return sendError(res, 'No score files found to import', 404);
    }

    // Get the most recent file's content
    const latestFile = files[0];
    console.log('[Scores/Import] Found latest file:', latestFile.name);

    const fileContent = await googleDrive.getFileContent(latestFile.id);
    console.log('[Scores/Import] Successfully read file content, length:', fileContent.length);

    // Initialize score import service and process the file
    console.log('[Scores/Import] Initializing score import service...');
    const importService = new ScoreImportService(leagueId);

    try {
      console.log('[Scores/Import] Starting score import process...');
      const result = await importService.importScoreFile(fileContent);
      console.log('[Scores/Import] Import completed successfully:', result);

      // Mark file as processed
      await googleDrive.markFileAsProcessed(latestFile.id);
      console.log('[Scores/Import] Marked file as processed:', latestFile.id);

      return sendSuccess(res, {
        message: 'Score import process completed successfully',
        fileName: latestFile.name,
        leagueId: leagueId,
        result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Scores/Import] Error during import:', error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error);

      if (error instanceof ScoreImportError) {
        return sendError(res, error.message, 400);
      } else {
        return sendError(res, 'Failed to import scores', 500);
      }
    }
  } catch (error) {
    console.error('[Scores/Import] Fatal error:', error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : error);

    return sendError(res, 'Failed to import scores', 500);
  }
});

// Add manual listing endpoint for debugging
router.get('/list-source', async (req, res) => {
  try {
    console.log('[Scores/ListSource] Starting file listing...');

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