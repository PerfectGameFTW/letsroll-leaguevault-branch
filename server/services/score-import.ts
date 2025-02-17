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
  InsertBowler,
  QubicaBowlerScore
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

  private cleanBowlerName(name: string): string {
    if (!name) return '';

    // Log original name for debugging
    console.log('[ScoreImport] Cleaning bowler name:', { original: name });

    // Remove trailing metadata patterns
    name = name.replace(/\s+M\s+\d+$/, ''); // Remove "M  54" pattern
    name = name.replace(/\s+W\s+\d+$/, ''); // Remove "W  54" pattern
    name = name.replace(/^\d+/, ''); // Remove leading numbers

    // Remove multiple spaces and trim
    name = name.replace(/\s+/g, ' ').trim();

    console.log('[ScoreImport] Cleaned bowler name:', {
      original: name,
      cleaned: name
    });

    return name;
  }

  private async createSquareCustomerIfNeeded(bowlerName: string, bowlerId: string): Promise<string | null> {
    try {
      // Clean the bowler name before creating Square customer
      const cleanedName = this.cleanBowlerName(bowlerName);

      // Create or update Square customer
      const squareCustomer = await createOrUpdateCustomer(cleanedName, null);
      console.log('[ScoreImport] Created/Updated Square customer:', {
        name: cleanedName,
        squareCustomerId: squareCustomer?.id
      });

      return squareCustomer?.id || null;
    } catch (error) {
      console.error('[ScoreImport] Failed to create/update Square customer:', error);
      return null;
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

  private async getTeamByQubicaNumber(leagueId: number, qubicaTeamNumber: string): Promise<Team | null> {
    try {
      // Convert Qubica team number to integer by removing leading zeros
      const teamNumber = parseInt(qubicaTeamNumber);

      if (isNaN(teamNumber)) {
        console.error('[ScoreImport] Invalid team number format:', {
          qubicaTeamNumber,
          parsed: teamNumber
        });
        return null;
      }

      console.log('[ScoreImport] Looking up team:', {
        leagueId,
        qubicaTeamNumber,
        parsedNumber: teamNumber
      });

      const team = await storage.getTeamByNumber(leagueId, teamNumber);
      return team || null; // Explicitly return null if undefined

    } catch (error) {
      console.error('[ScoreImport] Team lookup error:', error);
      return null;
    }
  }

  private async getOrCreateBowler(bowlerScore: QubicaBowlerScore): Promise<Bowler> {
    try {
      console.log('[ScoreImport] Looking up bowler:', {
        qubicaId: bowlerScore.bowlerId,
        name: bowlerScore.bowlerName,
        status: 'START_LOOKUP'
      });

      // First try to find existing bowler by QubicaID
      let bowler = await storage.getBowlerByQubicaId(bowlerScore.bowlerId);

      if (bowler) {
        console.log('[ScoreImport] Found existing bowler:', {
          id: bowler.id,
          dbName: bowler.name,
          importName: bowlerScore.bowlerName,
          qubicaId: bowler.qubicaId,
          status: 'MATCHED_EXISTING'
        });
        return bowler;
      }

      // If no existing bowler found, create new one
      const cleanedName = this.cleanBowlerName(bowlerScore.bowlerName);

      if (!cleanedName || cleanedName.length < 2) {
        console.error('[ScoreImport] Invalid bowler name:', {
          original: bowlerScore.bowlerName,
          cleaned: cleanedName,
          qubicaId: bowlerScore.bowlerId,
          status: 'VALIDATION_ERROR'
        });
        throw new Error(`Invalid bowler name: ${bowlerScore.bowlerName}`);
      }

      if (!bowlerScore.bowlerId || !/^\d+$/.test(bowlerScore.bowlerId)) {
        console.error('[ScoreImport] Invalid Qubica ID:', {
          qubicaId: bowlerScore.bowlerId,
          name: bowlerScore.bowlerName,
          status: 'VALIDATION_ERROR'
        });
        throw new Error(`Invalid Qubica ID: ${bowlerScore.bowlerId}`);
      }

      // Create Square customer (optional)
      const squareCustomerId = await this.createSquareCustomerIfNeeded(
        cleanedName,
        bowlerScore.bowlerId
      );

      // Create new bowler with QubicaID
      const insertBowler: InsertBowler = {
        name: cleanedName,
        qubicaId: bowlerScore.bowlerId,
        active: true,
        order: 0,
        squareCustomerId
      };

      bowler = await storage.createBowler(insertBowler);
      console.log('[ScoreImport] Created new bowler:', {
        id: bowler.id,
        name: bowler.name,
        qubicaId: bowler.qubicaId,
        status: 'CREATED_NEW'
      });

      return bowler;
    } catch (error) {
      console.error('[ScoreImport] Error in getOrCreateBowler:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        bowlerName: bowlerScore.bowlerName,
        qubicaId: bowlerScore.bowlerId,
        status: 'ERROR'
      });
      throw error;
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
            bowlerCount: parsedData.games[0].bowlers.length
          } : 'No games found'
        });
      } catch (error) {
        console.error('[ScoreImport] File parsing error:', error);
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
      const bowlerCache = new Map<string, Bowler>();

      console.log('[ScoreImport] Processing games:', {
        totalGames: parsedData.games.length
      });

      // Process each team game
      for (const teamGame of parsedData.games) {
        const game = createdGames.find(g => g.gameNumber === teamGame.gameNumber);
        if (!game) {
          console.error(`[ScoreImport] No game found for game number ${teamGame.gameNumber}`);
          continue;
        }

        // Get team using the lookup method
        const team = await this.getTeamByQubicaNumber(this.leagueId, teamGame.teamNumber);
        if (!team) {
          console.warn(`[ScoreImport] Skipping scores for team ${teamGame.teamNumber} - team not found`);
          continue;
        }

        // Process bowlers with enhanced validation
        for (const bowlerScore of teamGame.bowlers) {
          try {
            const bowler = await this.getOrCreateBowler(bowlerScore);

            // Create score entry
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
              frames: bowlerScore.frames || [],
              splits: bowlerScore.splits || [],
              notes: bowlerScore.notes || []
            };

            scores.push(insertScore);
          } catch (error) {
            console.error(`[ScoreImport] Error processing bowler ${bowlerScore.bowlerName}:`, error);
            continue;
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
          games: createdGames.length
        });

        return {
          gamesCreated: createdGames.length,
          scoresCreated: createdScores.length
        };
      } catch (error) {
        console.error('[ScoreImport] Error creating batch scores:', error);
        throw new ScoreImportError('Failed to create scores', 'SCORE_CREATION_ERROR');
      }
    } catch (error) {
      console.error('[ScoreImport] Import failed:', error);
      throw error;
    }
  }
}