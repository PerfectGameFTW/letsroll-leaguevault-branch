import { Router } from 'express';
import multer from 'multer';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';
import { ConquerorScoreParser } from '@shared/score-import';
import { insertGameSchema, insertScoreSchema } from "@shared/schema";
import { z } from 'zod';

const router = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Only accept .S00 files
    if (file.originalname.endsWith('.S00')) {
      cb(null, true);
    } else {
      cb(new Error('Only .S00 files are allowed'));
    }
  },
});

// Score import endpoint
router.post('/upload', upload.single('scoreFile'), async (req, res) => {
  try {
    console.log('[ScoreImport] Processing score file upload');

    if (!req.file) {
      return sendError(res, 'No file uploaded', 400);
    }

    if (!req.body.leagueId) {
      return sendError(res, 'League ID is required', 400);
    }

    const leagueId = parseInt(req.body.leagueId);
    if (isNaN(leagueId)) {
      return sendError(res, 'Invalid league ID', 400);
    }

    // Log file details and content preview
    console.log('[ScoreImport] File details:', {
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
    console.log('[ScoreImport] File content preview:', req.file.buffer.toString().substring(0, 500));

    // Parse the score file
    const parser = new ConquerorScoreParser();
    let scoreData;
    try {
      scoreData = await parser.parse(req.file.buffer);
      console.log('[ScoreImport] Parsed score data:', JSON.stringify(scoreData, null, 2));
    } catch (error) {
      console.error('[ScoreImport] Parser error:', error);
      return sendError(res, 'Failed to parse score file: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }

    // Validate the league exists
    const league = await storage.getLeague(leagueId);
    if (!league) {
      return sendError(res, 'League not found', 404);
    }

    if (!scoreData.scores || scoreData.scores.length === 0) {
      return sendError(res, 'No valid scores found in file');
    }

    // Create a game record for this set of scores with defensive checks
    const defaultGameNumber = 1; // Default to game 1 if not specified
    const gameData = {
      leagueId,
      weekNumber: scoreData.weekNumber,
      gameNumber: scoreData.scores[0]?.gameNumber || defaultGameNumber,
      date: scoreData.date,
    };

    console.log('[ScoreImport] Creating game with data:', gameData);

    let game;
    try {
      game = await storage.createGame(gameData);
      console.log('[ScoreImport] Created game:', game);
    } catch (error) {
      console.error('[ScoreImport] Error creating game:', error);
      return sendError(res, 'Failed to create game record');
    }

    // Process each score entry
    const scores = [];
    for (const entry of scoreData.scores) {
      try {
        // Find the bowler by QubicaId
        const bowler = await storage.getBowlerByQubicaId(entry.qubicaId);
        if (!bowler) {
          console.warn(`[ScoreImport] Bowler not found for QubicaId: ${entry.qubicaId}`);
          continue;
        }

        // Find the team for this bowler in the league
        const bowlerLeagues = await storage.getBowlerLeagues({
          bowlerId: bowler.id,
          leagueId: leagueId,
        });

        if (bowlerLeagues.length === 0) {
          console.warn(`[ScoreImport] Bowler ${bowler.id} not found in league ${leagueId}`);
          continue;
        }

        const score = {
          gameId: game.id,
          bowlerId: bowler.id,
          teamId: bowlerLeagues[0].teamId,
          score: entry.score,
          handicap: entry.handicap || 0,
          average: entry.average || 0,
          position: entry.position,
          isVacant: entry.isVacant || false,
          isAbsent: entry.isAbsent || false,
          isSub: entry.isSub || false,
          laneNumber: entry.laneNumber,
        };

        scores.push(score);
        console.log('[ScoreImport] Processed score entry:', score);
      } catch (error) {
        console.error('[ScoreImport] Error processing score entry:', error);
        continue;
      }
    }

    // Batch create all scores
    let createdScores = [];
    try {
      createdScores = await storage.createBatchScores(scores);
      console.log(`[ScoreImport] Successfully imported ${createdScores.length} scores`);
    } catch (error) {
      console.error('[ScoreImport] Error creating scores:', error);
      return sendError(res, 'Failed to create scores');
    }

    sendSuccess(res, {
      game,
      scoresImported: createdScores.length,
    });
  } catch (error) {
    console.error('[ScoreImport] Error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to import scores');
  }
});

export default router;