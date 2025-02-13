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

    // Parse the score file
    const parser = new ConquerorScoreParser();
    const scoreData = await parser.parse(req.file.buffer);

    // Validate the league exists
    const league = await storage.getLeague(leagueId);
    if (!league) {
      return sendError(res, 'League not found', 404);
    }

    // Create a game record for this set of scores
    const gameData = {
      leagueId,
      weekNumber: scoreData.weekNumber,
      gameNumber: scoreData.scores[0].gameNumber, // All scores in a file are for the same game
      date: scoreData.date,
    };

    const game = await storage.createGame(gameData);

    // Process each score entry
    const scores = [];
    for (const entry of scoreData.scores) {
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
        handicap: entry.handicap,
        average: entry.average,
        position: entry.position,
        isVacant: false,
        isAbsent: false,
        isSub: entry.isSub,
        laneNumber: entry.laneNumber,
      };

      scores.push(score);
    }

    // Batch create all scores
    const createdScores = await storage.createBatchScores(scores);

    console.log(`[ScoreImport] Successfully imported ${createdScores.length} scores`);
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