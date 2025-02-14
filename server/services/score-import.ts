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
    try {
      console.log('[ScoreImport] Starting score file import for league:', this.leagueId);

      // Parse the score file
      const parsedData = parseQubicaScoreFile(fileContent);
      console.log('[ScoreImport] Successfully parsed file header:', parsedData.header);
      console.log('[ScoreImport] Total games found:', parsedData.games.length);

      // Print parsed team numbers for debugging
      const teamNumbers = [...new Set(parsedData.games.map(g => g.teamNumber))];
      console.log('[ScoreImport] Team numbers found in file:', teamNumbers);

      // Validate league exists
      const league = await storage.getLeague(this.leagueId);
      if (!league) {
        throw new ScoreImportError('League not found', 'LEAGUE_NOT_FOUND');
      }

      // Validate QubicaAMF league ID matches if set
      if (league.qubicaId && league.qubicaId !== parsedData.header.leagueId) {
        console.error('[ScoreImport] League ID mismatch:', {
          expected: league.qubicaId,
          received: parsedData.header.leagueId
        });
        throw new ScoreImportError(
          'QubicaAMF league ID mismatch',
          'LEAGUE_ID_MISMATCH'
        );
      }

      // Create three games for this week
      const createdGames: Game[] = [];
      for (let gameNumber = 1; gameNumber <= 3; gameNumber++) {
        try {
          console.log(`[ScoreImport] Creating game ${gameNumber} for week ${parsedData.header.weekNumber}`);
          const insertGame: InsertGame = {
            leagueId: this.leagueId,
            weekNumber: parsedData.header.weekNumber,
            gameNumber,
            date: parsedData.header.date,
          };

          const game = await storage.createGame(insertGame);
          console.log(`[ScoreImport] Created game ${game.id} with gameNumber ${game.gameNumber}`);
          createdGames.push(game);
        } catch (error) {
          console.error(`[ScoreImport] Error creating game ${gameNumber}:`, error);
          throw new ScoreImportError(
            `Failed to create game ${gameNumber}`,
            'GAME_CREATION_ERROR'
          );
        }
      }

      // Process all scores
      const scores: InsertScore[] = [];
      const teamCache = new Map<string, Team>();
      const bowlerCache = new Map<string, Bowler>();

      // Process each game from the parsed data
      for (const teamGame of parsedData.games) {
        try {
          // Get game by game number (1, 2, or 3)
          const gameNumber = teamGame.gameNumber;
          console.log(`[ScoreImport] Processing team game ${gameNumber} for team ${teamGame.teamName} (${teamGame.teamNumber})`);

          // Find the corresponding game from our created games
          const game = createdGames.find(g => g.gameNumber === gameNumber);
          if (!game) {
            console.error(`[ScoreImport] No game found for game number ${gameNumber}`);
            continue;
          }

          // Get or cache team
          let team = teamCache.get(teamGame.teamNumber);
          if (!team) {
            team = await storage.getTeamByNumber(this.leagueId, parseInt(teamGame.teamNumber));
            console.log(`[ScoreImport] Team lookup result for number ${teamGame.teamNumber}:`, team);

            if (!team) {
              console.warn(`[ScoreImport] Team number ${teamGame.teamNumber} not found in league ${this.leagueId}`);
              continue;
            }
            teamCache.set(teamGame.teamNumber, team);
          }

          // Process bowlers for this team and game
          for (const bowlerScore of teamGame.bowlers) {
            try {
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
              console.log(`[ScoreImport] Added score for bowler ${bowler.name}:`, insertScore);
            } catch (error) {
              console.error(`[ScoreImport] Error processing bowler score:`, error);
              // Continue with other bowlers even if one fails
            }
          }
        } catch (error) {
          console.error(`[ScoreImport] Error processing team game:`, error);
          // Continue with other team games even if one fails
        }
      }

      // Batch create all scores
      console.log(`[ScoreImport] Creating ${scores.length} scores across ${createdGames.length} games`);
      await storage.createBatchScores(scores);

      return {
        gamesCreated: createdGames.length,
        scoresCreated: scores.length,
      };
    } catch (error) {
      console.error('[ScoreImport] Fatal error during score import:', error);
      throw error;
    }
  }
}