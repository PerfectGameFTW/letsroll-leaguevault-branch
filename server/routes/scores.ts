import { Router } from 'express';
import { storage } from '../storage.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { z } from 'zod';
import { ScoreImportService, ScoreImportError } from '../services/score-import.js';
import { GoogleDriveService } from '../services/google-drive.js';

// Enhanced validation schema with better error messages
const getScoresQuerySchema = z.object({
  leagueId: z.string().transform((val, ctx) => {
    const parsed = parseInt(val);
    if (isNaN(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "League ID must be a number"
      });
      return z.NEVER;
    }
    if (parsed < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "League ID must be greater than 0"
      });
      return z.NEVER;
    }
    return parsed;
  }),
  weekNumber: z.string().transform((val, ctx) => {
    const parsed = parseInt(val);
    if (isNaN(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Week number must be a number"
      });
      return z.NEVER;
    }
    if (parsed < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Week number must be greater than 0"
      });
      return z.NEVER;
    }
    return parsed;
  })
});

const router = Router();

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

// Get scores for a specific league and week
router.get('/league/:leagueId/week/:weekNumber', async (req, res) => {
  try {
    console.log('[Scores] Processing request with params:', req.params);

    try {
      const result = getScoresQuerySchema.safeParse({
        leagueId: req.params.leagueId,
        weekNumber: req.params.weekNumber
      });

      if (!result.success) {
        console.log('[Scores] Validation errors:', result.error.flatten());
        const errors = result.error.errors.map(error => ({
          field: error.path[0],
          message: error.message
        }));
        return sendError(res, {
          message: 'Invalid parameters',
          details: errors
        }, 400);
      }

      const { leagueId, weekNumber } = result.data;
      console.log('[Scores] Validated parameters:', { leagueId, weekNumber });

      // Get scores for the specified league and week
      const scores = await storage.getScoresByLeagueAndWeek(leagueId, weekNumber);
      console.log('[Scores] Found scores:', scores.length);

      return sendSuccess(res, scores);
    } catch (validationError) {
      console.error('[Scores] Validation error:', validationError);
      if (validationError instanceof z.ZodError) {
        const errors = validationError.errors.map(error => ({
          field: error.path[0],
          message: error.message
        }));
        return sendError(res, {
          message: 'Invalid request parameters',
          details: errors
        }, 400);
      }
      throw validationError;
    }
  } catch (error) {
    console.error('[Scores] Error fetching scores:', error);
    return sendError(res, {
      message: 'Failed to fetch scores',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
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
    const archiveFolderId = process.env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID;

    if (!sourceFolderId || !archiveFolderId) {
      console.error('[Scores/Import] Source or archive folder ID not configured');
      return sendError(res, 'Source or archive folder ID not configured', 500);
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

      // Move file to archive after successful processing
      try {
        await googleDrive.moveToArchive(latestFile.id, archiveFolderId);
        console.log('[Scores/Import] Moved file to archive:', latestFile.id);
      } catch (archiveError) {
        console.error('[Scores/Import] Error moving file to archive:', archiveError);
        // Don't fail the request if archiving fails, just log the error
      }

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