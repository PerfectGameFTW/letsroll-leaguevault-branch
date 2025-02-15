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
    try {
      // Parse the score file
      console.log('[ScoreImport] Starting to parse score file...');
      const parsedData = parseQubicaScoreFile(fileContent);
      console.log('[ScoreImport] Parsed data header:', JSON.stringify(parsedData.header, null, 2));
      console.log('[ScoreImport] Total games in parsed data:', parsedData.games.length);

      // Log game distribution in parsed data
      const gameDistribution = parsedData.games.reduce((acc, game) => {
        acc[game.gameNumber] = (acc[game.gameNumber] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      console.log('[ScoreImport] Game distribution in parsed data:', gameDistribution);

      // Validate league exists
      const league = await storage.getLeague(this.leagueId);
      console.log('[ScoreImport] League lookup result:', league ? `Found league ${league.name}` : 'League not found');

      if (!league) {
        throw new ScoreImportError('League not found', 'LEAGUE_NOT_FOUND');
      }

      // Validate QubicaAMF league ID matches if set
      if (league.qubicaId && league.qubicaId !== parsedData.header.leagueId) {
        console.error('[ScoreImport] League ID mismatch:', {
          expected: league.qubicaId,
          actual: parsedData.header.leagueId
        });
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

        try {
          const game = await storage.createGame(insertGame);
          console.log(`[ScoreImport] Created game ${game.id} with gameNumber ${game.gameNumber}`);
          createdGames.push(game);
        } catch (error) {
          console.error(`[ScoreImport] Error creating game:`, error);
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
        console.log(`[ScoreImport] Processing team game:`, {
          gameNumber,
          teamNumber: teamGame.teamNumber,
          teamName: teamGame.teamName,
          bowlerCount: teamGame.bowlers.length
        });

        // Find the corresponding game from our created games
        const game = createdGames.find(g => g.gameNumber === gameNumber);
        if (!game) {
          console.error(`[ScoreImport] No game found for game number ${gameNumber}`);
          continue;
        }

        // Get or cache team
        let team = teamCache.get(teamGame.teamNumber);
        if (!team) {
          console.log(`[ScoreImport] Looking up team number ${teamGame.teamNumber}`);
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
          console.log(`[ScoreImport] Processing bowler:`, {
            name: bowlerScore.bowlerName,
            id: bowlerScore.bowlerId,
            score: bowlerScore.score,
            position: bowlerScore.position
          });

          // Get or cache bowler
          let bowler = bowlerCache.get(bowlerScore.bowlerId);
          if (!bowler) {
            bowler = await storage.getBowlerByQubicaId(bowlerScore.bowlerId);
            if (!bowler) {
              console.log(`[ScoreImport] Creating new bowler: ${bowlerScore.bowlerName} (${bowlerScore.bowlerId})`);
              try {
                bowler = await storage.createBowler({
                  name: bowlerScore.bowlerName,
                  email: `${bowlerScore.bowlerId}@placeholder.com`,
                  qubicaId: bowlerScore.bowlerId,
                  active: true,
                  order: 0,
                });
              } catch (error) {
                console.error(`[ScoreImport] Error creating bowler:`, error);
                continue;
              }
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
          console.log(`[ScoreImport] Added score:`, {
            gameId: game.id,
            bowlerId: bowler.id,
            teamId: team.id,
            score: bowlerScore.score
          });
        }
      }

      // Batch create all scores
      console.log(`[ScoreImport] Creating ${scores.length} scores across ${createdGames.length} games`);

      try {
        await storage.createBatchScores(scores);
        console.log('[ScoreImport] Successfully created all scores');
      } catch (error) {
        console.error('[ScoreImport] Error creating batch scores:', error);
        throw error;
      }

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