import { parseQubicaScoreFile } from '../utils/qubica-parser.js';
import { storage } from '../storage.js';
import { createOrUpdateCustomer } from './square.js';
import type {
  QubicaScoreImport,
  InsertGame,
  InsertScore,
  Game,
  Score,
  Bowler,
  Team,
  InsertBowler
} from '@shared/schema';

export class ScoreImportError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'ScoreImportError';
  }
}

export class ScoreImportService {
  constructor(private leagueId: number) {
    console.log('[ScoreImportService] Initialized with leagueId:', leagueId);
  }

  private async createSquareCustomerIfNeeded(bowlerName: string, bowlerId: string): Promise<string | null> {
    try {
      // Generate a consistent email using bowler ID
      const email = `${bowlerId}@placeholder.com`;

      // Create or update Square customer
      const squareCustomer = await createOrUpdateCustomer(bowlerName, email);
      console.log('[ScoreImport] Created/Updated Square customer:', {
        name: bowlerName,
        email,
        squareCustomerId: squareCustomer?.id
      });

      return squareCustomer?.id || null;
    } catch (error) {
      console.error('[ScoreImport] Failed to create/update Square customer:', error);
      throw new ScoreImportError('Failed to create Square customer', 'SQUARE_CUSTOMER_ERROR');
    }
  }

  private validateAndPrepareDate(date: Date): Date {
    try {
      // If the date is too old (like 1899), use today's date
      const minValidDate = new Date('2020-01-01');
      if (date < minValidDate) {
        console.log('[ScoreImport] Converting invalid historical date to current date');
        return new Date();
      }

      // Convert to UTC midnight
      const utcDate = new Date(date);
      utcDate.setUTCHours(0, 0, 0, 0);

      console.log('[ScoreImport] Prepared date:', {
        original: date.toISOString(),
        prepared: utcDate.toISOString(),
        timestamp: utcDate.getTime()
      });

      return utcDate;
    } catch (error) {
      console.error('[ScoreImport] Date validation error:', error);
      throw new ScoreImportError('Invalid date format', 'DATE_FORMAT_ERROR');
    }
  }

  async importScoreFile(fileContent: string): Promise<{
    gamesCreated: number;
    scoresCreated: number;
  }> {
    const createdGames: Game[] = [];
    const scores: InsertScore[] = [];

    try {
      console.log('[ScoreImport] Starting import process...');

      // Debug log the file content
      console.log('[ScoreImport] File content analysis:', {
        totalLength: fileContent.length,
        firstLines: fileContent.split('\n').slice(0, 5).map(line => ({
          content: line,
          length: line.length,
          charCodes: line.split('').map(c => c.charCodeAt(0))
        }))
      });

      // Parse file content
      let parsedData: QubicaScoreImport;
      try {
        parsedData = parseQubicaScoreFile(fileContent);
        console.log('[ScoreImport] Successfully parsed score file:', {
          header: {
            ...parsedData.header,
            date: parsedData.header.date.toISOString(),
            weekNumber: parsedData.header.weekNumber
          },
          gamesCount: parsedData.games.length,
          sampleGame: parsedData.games[0] ? {
            teamNumber: parsedData.games[0].teamNumber,
            laneNumber: parsedData.games[0].laneNumber,
            bowlerCount: parsedData.games[0].bowlers.length,
            bowlers: parsedData.games[0].bowlers.map(b => ({
              name: b.bowlerName,
              score: b.score,
              position: b.position
            }))
          } : 'No games found'
        });
      } catch (error) {
        console.error('[ScoreImport] File parsing error:', {
          error: error instanceof Error ? {
            name: error.name,
            message: error.message,
            stack: error.stack
          } : error,
          fileContentSample: fileContent.substring(0, 200)
        });
        throw new ScoreImportError('Failed to parse score file', 'PARSE_ERROR');
      }

      // Validate date
      if (!parsedData.header.date || isNaN(parsedData.header.date.getTime())) {
        console.error('[ScoreImport] Invalid date from parser:', parsedData.header.date);
        throw new ScoreImportError('Invalid date in score file', 'INVALID_DATE');
      }

      // Validate league exists
      const league = await storage.getLeague(this.leagueId);
      if (!league) {
        throw new ScoreImportError('League not found', 'LEAGUE_NOT_FOUND');
      }

      // Prepare the game date
      const gameDate = this.validateAndPrepareDate(parsedData.header.date);

      // Create games for the week
      try {
        console.log('[ScoreImport] Creating games for week:', {
          weekNumber: parsedData.header.weekNumber,
          date: gameDate.toISOString()
        });

        for (let gameNumber = 1; gameNumber <= 3; gameNumber++) {
          const insertGame: InsertGame = {
            leagueId: this.leagueId,
            weekNumber: parsedData.header.weekNumber,
            gameNumber,
            date: gameDate
          };

          const game = await storage.createGame(insertGame);
          console.log(`[ScoreImport] Created game ${gameNumber}:`, {
            gameId: game.id,
            date: game.date,
            weekNumber: game.weekNumber
          });

          createdGames.push(game);
        }
      } catch (error) {
        console.error('[ScoreImport] Error creating games:', error);
        throw new ScoreImportError('Failed to create games', 'GAME_CREATION_ERROR');
      }

      // Process scores
      const teamCache = new Map<string, Team>();
      const bowlerCache = new Map<string, Bowler>();

      console.log('[ScoreImport] Processing games:', {
        totalGames: parsedData.games.length,
        sampleGame: parsedData.games[0] ? {
          teamNumber: parsedData.games[0].teamNumber,
          laneNumber: parsedData.games[0].laneNumber,
          bowlerCount: parsedData.games[0].bowlers.length,
          bowlerNames: parsedData.games[0].bowlers.map(b => b.bowlerName)
        } : 'No games'
      });

      // Process each team game
      for (const teamGame of parsedData.games) {
        const game = createdGames.find(g => g.gameNumber === teamGame.gameNumber);
        if (!game) {
          console.error(`[ScoreImport] No game found for game number ${teamGame.gameNumber}`);
          continue;
        }

        // Get or cache team
        let team = teamCache.get(teamGame.teamNumber);
        if (!team) {
          team = await storage.getTeamByNumber(this.leagueId, parseInt(teamGame.teamNumber));
          if (!team) {
            console.warn(`[ScoreImport] Team ${teamGame.teamNumber} not found`);
            continue;
          }
          teamCache.set(teamGame.teamNumber, team);
        }

        // Process bowlers
        for (const bowlerScore of teamGame.bowlers) {
          try {
            // Get or cache bowler
            let bowler = bowlerCache.get(bowlerScore.bowlerId);
            if (!bowler) {
              bowler = await storage.getBowlerByQubicaId(bowlerScore.bowlerId);

              if (!bowler) {
                try {
                  // Create Square customer first
                  const squareCustomerId = await this.createSquareCustomerIfNeeded(
                    bowlerScore.bowlerName,
                    bowlerScore.bowlerId
                  );

                  // Create bowler with Square integration
                  const insertBowler: InsertBowler = {
                    name: bowlerScore.bowlerName,
                    email: `${bowlerScore.bowlerId}@placeholder.com`,
                    qubicaId: bowlerScore.bowlerId,
                    active: true,
                    order: 0,
                    squareCustomerId
                  };

                  bowler = await storage.createBowler(insertBowler);
                  console.log(`[ScoreImport] Created bowler with Square integration:`, {
                    bowlerId: bowler.id,
                    name: bowler.name,
                    squareCustomerId: bowler.squareCustomerId
                  });
                } catch (error) {
                  console.error(`[ScoreImport] Error creating bowler:`, error);
                  throw new ScoreImportError('Failed to create bowler', 'BOWLER_CREATION_ERROR');
                }
              }

              bowlerCache.set(bowlerScore.bowlerId, bowler);
            }

            // Create score
            const insertScore: InsertScore = {
              gameId: game.id,
              bowlerId: bowler.id,
              teamId: team.id,
              score: bowlerScore.score,
              handicap: bowlerScore.handicap || 0,
              average: bowlerScore.average || 0,
              position: bowlerScore.position,
              isVacant: bowlerScore.status.isVacant,
              isAbsent: bowlerScore.status.isAbsent,
              isSub: bowlerScore.status.isSub,
              laneNumber: teamGame.laneNumber,
              frames: [],
              splits: [],
              notes: []
            };

            scores.push(insertScore);
          } catch (error) {
            console.error(`[ScoreImport] Error processing bowler ${bowlerScore.bowlerName}:`, error);
            throw error;
          }
        }
      }

      // Create scores in batch
      try {
        console.log('[ScoreImport] Attempting to create batch scores:', {
          count: scores.length,
          sample: scores.slice(0, 2).map(score => ({
            gameId: score.gameId,
            bowlerId: score.bowlerId,
            teamId: score.teamId,
            score: score.score,
            laneNumber: score.laneNumber
          }))
        });

        const createdScores = await storage.createBatchScores(scores);
        console.log('[ScoreImport] Successfully created scores:', {
          total: createdScores.length,
          games: createdGames.length,
          sample: createdScores.slice(0, 2).map(score => ({
            id: score.id,
            gameId: score.gameId,
            score: score.score
          }))
        });

        return {
          gamesCreated: createdGames.length,
          scoresCreated: createdScores.length
        };
      } catch (error) {
        console.error('[ScoreImport] Error creating batch scores:', {
          error: error instanceof Error ? {
            name: error.name,
            message: error.message,
            stack: error.stack
          } : error,
          scoreCount: scores.length,
          sampleScore: scores[0] ? {
            gameId: scores[0].gameId,
            bowlerId: scores[0].bowlerId,
            teamId: scores[0].teamId,
            score: scores[0].score
          } : 'No scores'
        });
        throw new ScoreImportError('Failed to create scores', 'SCORE_CREATION_ERROR');
      }
    } catch (error) {
      console.error('[ScoreImport] Import failed:', error);
      throw error;
    }
  }
}