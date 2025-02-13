import { Router } from 'express';
import { ScoreImportService } from '../services/score-import.js';
import type { ApiResponse } from '@shared/schema';

const router = Router();

router.post('/leagues/:leagueId/import-scores', async (req, res) => {
  try {
    // Validate league ID
    const leagueId = parseInt(req.params.leagueId);
    if (isNaN(leagueId)) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid league ID',
          code: 'INVALID_LEAGUE_ID'
        }
      });
    }

    // Check if file content is provided
    if (!req.body.fileContent) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'No file content provided',
          code: 'NO_FILE_CONTENT'
        }
      });
    }

    // Create score import service and process file
    const importService = new ScoreImportService(leagueId);
    const result = await importService.importScoreFile(req.body.fileContent);

    return res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('[ScoreImport] Error importing scores:', error);
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        code: error.code || 'UNKNOWN_ERROR'
      }
    });
  }
});

export default router;
