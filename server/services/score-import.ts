import { parseQubicaScoreFile } from '../utils/qubica-parser';
import { storage } from '../storage';
import type {
  QubicaScoreImport,
  InsertGame,
  InsertScore,
  Game,
  Score,
  Bowler,
  Team
} from '@shared/schema';

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
    console.log('[ScoreImport] Parsed data header:', parsedData.header);

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

    // Create three games for this week
    const createdGames: Game[] = [];
    for (let gameNumber = 1; gameNumber <= 3; gameNumber++) {
      console.log(`[ScoreImport] Creating game ${gameNumber} for week ${parsedData.header.weekNumber}`);
      const insertGame: InsertGame = {
        leagueId: this.leagueId,
        weekNumber: parsedData.header.weekNumber,
        gameNumber,
        date: parsedData.header.date,
      };

      const game = await storage.createGame(insertGame);
      createdGames.push(game);
    }

    // Process all scores
    const scores: InsertScore[] = [];
    const teamCache = new Map<string, Team>();
    const bowlerCache = new Map<string, Bowler>();

    // Process each game from the parsed data
    for (const teamGame of parsedData.games) {
      // Get game by game number (1, 2, or 3)
      const gameNumber = teamGame.gameNumber;
      const game = createdGames[gameNumber - 1];

      if (!game) {
        console.error(`[ScoreImport] No game found for game number ${gameNumber}`);
        continue;
      }

      // Get or cache team
      let team = teamCache.get(teamGame.teamNumber);
      if (!team) {
        team = await storage.getTeamByNumber(this.leagueId, parseInt(teamGame.teamNumber));
        if (!team) {
          console.warn(`[ScoreImport] Team number ${teamGame.teamNumber} not found in league ${this.leagueId}`);
          continue;
        }
        teamCache.set(teamGame.teamNumber, team);
      }

      // Process bowlers for this team and game
      console.log(`[ScoreImport] Processing ${teamGame.bowlers.length} bowlers for team ${team.name} game ${gameNumber}`);

      for (const bowlerScore of teamGame.bowlers) {
        // Get or cache bowler
        let bowler = bowlerCache.get(bowlerScore.bowlerId);
        if (!bowler) {
          bowler = await storage.getBowlerByQubicaId(bowlerScore.bowlerId);
          if (!bowler) {
            console.log(`[ScoreImport] Creating new bowler: ${bowlerScore.bowlerName} (${bowlerScore.bowlerId})`);
            bowler = await storage.createBowler({
              name: bowlerScore.bowlerName,
              email: `${bowlerScore.bowlerId}@placeholder.com`,
              qubicaId: bowlerScore.bowlerId,
              active: true,
              order: 0,
            });
          }
          bowlerCache.set(bowlerScore.bowlerId, bowler);
        }

        // Create score record
        const insertScore: InsertScore = {
          gameId: game.id,
          bowlerId: bowler.id,
          teamId: team.id,
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
    console.log(`[ScoreImport] Creating ${scores.length} scores across ${createdGames.length} games`);

    // Log distribution of scores across games
    const scoresByGame = scores.reduce((acc, score) => {
      acc[score.gameId] = (acc[score.gameId] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    console.log('[ScoreImport] Score distribution by game:', scoresByGame);

    await storage.createBatchScores(scores);

    return {
      gamesCreated: createdGames.length,
      scoresCreated: scores.length,
    };
  }
}