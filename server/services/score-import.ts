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

      // Create Square customer
      const squareCustomer = await createOrUpdateCustomer(bowlerName, email);
      console.log(`[ScoreImport] Created/Updated Square customer for ${bowlerName}:`, squareCustomer?.id);

      return squareCustomer?.id || null;
    } catch (error) {
      console.error(`[ScoreImport] Failed to create/update Square customer for ${bowlerName}:`, error);
      return null;
    }
  }

  private validateAndConvertDate(date: Date): Date {
    // If the date is too old (like 1899), use today's date
    const minValidDate = new Date('2020-01-01');
    if (date < minValidDate) {
      console.log('[ScoreImport] Converting invalid historical date to current date');
      return new Date();
    }
    // Ensure we return a proper Date object with time set to start of day
    const validDate = new Date(date);
    validDate.setUTCHours(0, 0, 0, 0);
    return validDate;
  }

  async importScoreFile(fileContent: string): Promise<{
    gamesCreated: number;
    scoresCreated: number;
  }> {
    try {
      console.log('[ScoreImport] Starting import process...');

      // Parse file content
      console.log('[ScoreImport] Parsing score file...');
      const parsedData = parseQubicaScoreFile(fileContent);

      // Verify date
      if (!parsedData.header.date || isNaN(parsedData.header.date.getTime())) {
        console.error('[ScoreImport] Invalid date from parser:', parsedData.header.date);
        throw new ScoreImportError('Invalid date in score file', 'INVALID_DATE');
      }

      // Convert to proper Date object
      const gameDate = this.validateAndConvertDate(parsedData.header.date);
      console.log('[ScoreImport] Using game date:', {
        date: gameDate,
        isoString: gameDate.toISOString(),
        isDate: gameDate instanceof Date
      });

      // Validate league exists
      const league = await storage.getLeague(this.leagueId);
      if (!league) {
        throw new ScoreImportError('League not found', 'LEAGUE_NOT_FOUND');
      }

      // Create three games for this week
      const createdGames: Game[] = [];
      for (let gameNumber = 1; gameNumber <= 3; gameNumber++) {
        try {
          const insertGame: InsertGame = {
            leagueId: this.leagueId,
            weekNumber: parsedData.header.weekNumber,
            gameNumber,
            date: gameDate // Pass the Date object directly
          };

          const game = await storage.createGame(insertGame);
          console.log(`[ScoreImport] Created game ${gameNumber}:`, {
            gameId: game.id,
            gameNumber: game.gameNumber,
            date: game.date,
            weekNumber: game.weekNumber
          });

          createdGames.push(game);
        } catch (error) {
          console.error(`[ScoreImport] Error creating game ${gameNumber}:`, error);
          throw error;
        }
      }

      // Process all scores
      const scores: InsertScore[] = [];
      const teamCache = new Map<string, Team>();
      const bowlerCache = new Map<string, Bowler>();

      // Process each game from the parsed data
      console.log(`[ScoreImport] Processing ${parsedData.games.length} team games...`);
      for (const teamGame of parsedData.games) {
        const gameNumber = teamGame.gameNumber;

        const game = createdGames.find(g => g.gameNumber === gameNumber);
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
        for (const bowlerScore of teamGame.bowlers) {
          try {
            // Get or cache bowler
            let bowler = bowlerCache.get(bowlerScore.bowlerId);
            if (!bowler) {
              bowler = await storage.getBowlerByQubicaId(bowlerScore.bowlerId);

              if (!bowler) {
                // Create or update Square customer first
                const squareCustomerId = await this.createSquareCustomerIfNeeded(
                  bowlerScore.bowlerName,
                  bowlerScore.bowlerId
                );

                // Create new bowler with Square customer ID if available
                const insertBowler: InsertBowler = {
                  name: bowlerScore.bowlerName,
                  email: `${bowlerScore.bowlerId}@placeholder.com`,
                  qubicaId: bowlerScore.bowlerId,
                  active: true,
                  order: 0,
                  squareCustomerId
                };

                bowler = await storage.createBowler(insertBowler);
              }

              bowlerCache.set(bowlerScore.bowlerId, bowler);
            }

            // Create score record
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

      // Create all scores in a batch
      console.log(`[ScoreImport] Creating ${scores.length} scores in batch`);
      const createdScores = await storage.createBatchScores(scores);

      return {
        gamesCreated: createdGames.length,
        scoresCreated: createdScores.length
      };
    } catch (error) {
      console.error('[ScoreImport] Fatal error during score import:', error);
      throw error;
    }
  }
}