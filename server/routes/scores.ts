import { Router } from 'express';
import { storage } from '../storage.js';
import { sendSuccess, sendError, type ApiError } from '../utils/api.js';
import { z } from 'zod';
import { ScoreImportService, ScoreImportError } from '../services/score-import.js';
import { GoogleDriveService } from '../services/google-drive.js';
import { type Request, type Response, type NextFunction } from 'express';

const router = Router();

// Validation middleware
const validateScoreParams = (req: Request, res: Response, next: NextFunction) => {
  const { leagueId, weekNumber } = req.params;
  const errors = [];

  // Validate leagueId
  const parsedLeagueId = parseInt(leagueId);
  if (isNaN(parsedLeagueId)) {
    errors.push({ field: 'leagueId', message: 'League ID must be a valid number' });
  } else if (parsedLeagueId <= 0) {
    errors.push({ field: 'leagueId', message: 'League ID must be greater than 0' });
  }

  // Validate weekNumber
  const parsedWeekNumber = parseInt(weekNumber);
  if (isNaN(parsedWeekNumber)) {
    errors.push({ field: 'weekNumber', message: 'Week number must be a valid number' });
  } else if (parsedWeekNumber <= 0) {
    errors.push({ field: 'weekNumber', message: 'Week number must be greater than 0' });
  }

  if (errors.length > 0) {
    const error: ApiError = {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request parameters',
      details: errors
    };
    return sendError(res, error, 400);
  }

  // Add validated parameters to request
  req.params.leagueId = parsedLeagueId.toString();
  req.params.weekNumber = parsedWeekNumber.toString();
  next();
};

// Add debug endpoint for testing validation
router.get('/debug-query', (req, res) => {
  console.log('[Scores/Debug] Raw query:', req.query);
  return sendSuccess(res, {
    query: req.query,
    url: req.url
  });
});

// Route handler for getting league scores by week
router.get('/league/:leagueId/week/:weekNumber', validateScoreParams, async (req, res) => {
  try {
    console.log('[Scores] Processing request with params:', req.params);

    const leagueId = parseInt(req.params.leagueId);
    const weekNumber = parseInt(req.params.weekNumber);

    // Get scores for the specified league and week
    const scores = await storage.getScoresByLeagueAndWeek(leagueId, weekNumber);
    console.log('[Scores] Found scores:', scores.length);

    return sendSuccess(res, scores);
  } catch (error) {
    console.error('[Scores] Error fetching scores:', error);
    return sendError(res, {
      code: 'SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Failed to fetch scores'
    }, 500);
  }
});

// Get historical scores for a team or bowler
router.get('/history', async (req, res) => {
  try {
    console.log('[Scores/History] Processing request with query:', req.query);

    const { leagueId, weekNumber } = req.query;
    const parsedLeagueId = leagueId ? parseInt(leagueId as string) : undefined;
    const parsedWeekNumber = weekNumber ? parseInt(weekNumber as string) : undefined;

    if (parsedLeagueId && parsedWeekNumber) {
      if (isNaN(parsedLeagueId) || parsedLeagueId <= 0) {
        return sendError(res, {
          code: 'VALIDATION_ERROR',
          message: 'League ID must be a positive number',
          details: [{ field: 'leagueId', message: 'Must be a positive number' }]
        }, 400);
      }

      if (isNaN(parsedWeekNumber) || parsedWeekNumber <= 0) {
        return sendError(res, {
          code: 'VALIDATION_ERROR',
          message: 'Week number must be a positive number',
          details: [{ field: 'weekNumber', message: 'Must be a positive number' }]
        }, 400);
      }

      const games = await storage.getGames(parsedLeagueId, parsedWeekNumber);
      const allScores = [];
      for (const game of games) {
        const gameScores = await storage.getGameScores(game.id);
        allScores.push(...gameScores);
      }

      return sendSuccess(res, allScores);
    }

    return sendError(res, {
      code: 'VALIDATION_ERROR',
      message: 'Invalid query parameters: leagueId and weekNumber must be provided',
      details: []
    }, 400);

  } catch (error) {
    console.error('[Scores/History] Error fetching scores:', error);
    return sendError(res, {
      code: 'SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Failed to fetch scores'
    }, 500);
  }
});

// Enhanced import route to use Google Drive
router.post('/import', async (req, res) => {
  try {
    const leagueId = parseInt(req.query.leagueId as string);
    console.log('[Scores/Import] Processing import request for league:', leagueId);

    if (isNaN(leagueId)) {
      console.error('[Scores/Import] Invalid league ID provided:', req.query.leagueId);
      return sendError(res, {
        code: 'VALIDATION_ERROR',
        message: 'Invalid league ID',
        details: [{ field: 'leagueId', message: 'Must be a valid number' }]
      }, 400);
    }

    // Check if league exists
    const league = await storage.getLeague(leagueId);
    if (!league) {
      console.error('[Scores/Import] League not found:', leagueId);
      return sendError(res, {
        code: 'NOT_FOUND',
        message: 'League not found',
        details: [{ field: 'leagueId', message: 'No league found with this ID' }]
      }, 404);
    }

    // Initialize Google Drive service
    console.log('[Scores/Import] Initializing GoogleDriveService...');
    const googleDrive = new GoogleDriveService();
    const sourceFolderId = process.env.GOOGLE_DRIVE_SOURCE_FOLDER_ID;
    const archiveFolderId = process.env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID;

    if (!sourceFolderId || !archiveFolderId) {
      console.error('[Scores/Import] Source or archive folder ID not configured');
      return sendError(res, {
        code: 'CONFIG_ERROR',
        message: 'Source or archive folder ID not configured'
      }, 500);
    }

    // List and get the latest file
    console.log('[Scores/Import] Fetching files from Google Drive folder:', sourceFolderId);
    const files = await googleDrive.listNewFiles(sourceFolderId);

    if (files.length === 0) {
      console.error('[Scores/Import] No files found in source folder');
      return sendError(res, {
        code: 'NOT_FOUND',
        message: 'No score files found to import'
      }, 404);
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
      if (error instanceof ScoreImportError) {
        return sendError(res, {
          code: 'IMPORT_ERROR',
          message: error.message
        }, 400);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('[Scores/Import] Fatal error:', error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : error);

    return sendError(res, {
      code: 'SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Failed to import scores'
    }, 500);
  }
});

export default router;