import { parseQubicaScoreFile } from '../utils/qubica-parser.js';
import { storage } from '../storage.js';
import type {
  QubicaScoreImport,
  InsertGame,
  InsertScore,
  Game,
  Score,
  Bowler,
  Team
} from '@shared/schema.js';

export class ScoreImportError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'ScoreImportError';
  }
}

export class ScoreImportService {
  constructor(private leagueId: number) {}

  async importScoreFile(fileContent: string): Promise<{
    gamesCreated: number;
    scoresCreated: number;
  }> {
    // Parse the score file
    const parsedData = parseQubicaScoreFile(fileContent);

    // Validate league exists
    const league = await storage.getLeague(this.leagueId);
    if (!league) {
      throw new ScoreImportError('League not found', 'LEAGUE_NOT_FOUND');
    }

    // Validate QubicaAMF league ID matches if set
    if (league.qubicaId && league.qubicaId !== parsedData.header.leagueId) {
      throw new ScoreImportError(
        'QubicaAMF league ID mismatch',
        'LEAGUE_ID_MISMATCH'
      );
    }

    // Create games first
    const games: Game[] = [];
    for (let gameNumber = 1; gameNumber <= 3; gameNumber++) {
      const insertGame: InsertGame = {
        leagueId: this.leagueId,
        weekNumber: parsedData.header.weekNumber,
        gameNumber,
        date: parsedData.header.date,
      };

      const game = await storage.createGame(insertGame);
      games.push(game);
    }

    // Process all scores
    const scores: InsertScore[] = [];
    const teamCache = new Map<string, Team>();

    for (const teamGame of parsedData.games) {
      // Get or cache team
      let team = teamCache.get(teamGame.teamNumber);
      if (!team) {
        team = await storage.getTeamByNumber(this.leagueId, parseInt(teamGame.teamNumber));
        if (!team) {
          console.warn(`Team number ${teamGame.teamNumber} not found in league ${this.leagueId}`);
          continue;
        }
        teamCache.set(teamGame.teamNumber, team);
      }

      // Find or create bowlers by QubicaAMF ID
      for (const bowlerScore of teamGame.bowlers) {
        const game = games.find(g => g.gameNumber === teamGame.gameNumber);
        if (!game) continue;

        // Get or create bowler
        let bowler = await storage.getBowlerByQubicaId(bowlerScore.bowlerId);
        if (!bowler) {
          bowler = await storage.createBowler({
            name: bowlerScore.bowlerName,
            email: `${bowlerScore.bowlerId}@placeholder.com`,
            qubicaId: bowlerScore.bowlerId,
            active: true,
            order: 0,
          });
        }

        // Create score record
        const insertScore: InsertScore = {
          gameId: game.id,
          bowlerId: bowler.id,
          teamId: team.id, // Use the actual team ID from database
          score: bowlerScore.score,
          handicap: bowlerScore.handicap,
          average: bowlerScore.average,
          position: bowlerScore.position,
          isVacant: bowlerScore.status.isVacant,
          isAbsent: bowlerScore.status.isAbsent,
          isSub: bowlerScore.status.isSub,
          laneNumber: bowlerScore.laneNumber,
        };

        scores.push(insertScore);
      }
    }

    // Batch create all scores
    await storage.createBatchScores(scores);

    return {
      gamesCreated: games.length,
      scoresCreated: scores.length,
    };
  }
}