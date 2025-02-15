import { parseQubicaScoreFile } from '../utils/qubica-parser.js';
import { storage } from '../storage.js';
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

  async importScoreFile(fileContent: string): Promise<{
    gamesCreated: number;
    scoresCreated: number;
  }> {
    try {
      // Add extensive debug logging
      console.log('[ScoreImport] Starting import process...');
      console.log('[ScoreImport] File content length:', fileContent.length);
      console.log('[ScoreImport] First 200 chars:', fileContent.substring(0, 200));

      // Parse file content
      console.log('[ScoreImport] Parsing score file...');
      const parsedData = parseQubicaScoreFile(fileContent);
      console.log('[ScoreImport] Parsed data header:', JSON.stringify(parsedData.header, null, 2));
      console.log('[ScoreImport] Total games in parsed data:', parsedData.games.length);

      // Log detailed game information
      console.log('[ScoreImport] Games breakdown:');
      const gamesByTeam = new Map<string, number[]>();
      parsedData.games.forEach(game => {
        const key = `${game.teamNumber}-${game.teamName}`;
        const games = gamesByTeam.get(key) || [];
        games.push(game.gameNumber);
        gamesByTeam.set(key, games);
      });

      for (const [team, games] of gamesByTeam.entries()) {
        console.log(`Team ${team}: Games ${games.join(', ')}`);
      }

      // Validate league exists
      const league = await storage.getLeague(this.leagueId);
      console.log('[ScoreImport] League lookup result:', league ? `Found league ${league.name}` : 'League not found');

      if (!league) {
        throw new ScoreImportError('League not found', 'LEAGUE_NOT_FOUND');
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
            position: bowlerScore.position,
            status: bowlerScore.status
          });

          try {
            // Get or cache bowler with retry logic
            let bowler = bowlerCache.get(bowlerScore.bowlerId);
            if (!bowler) {
              console.log(`[ScoreImport] Looking up bowler by QubicaId: ${bowlerScore.bowlerId}`);
              bowler = await storage.getBowlerByQubicaId(bowlerScore.bowlerId);

              if (!bowler) {
                console.log(`[ScoreImport] Creating new bowler: ${bowlerScore.bowlerName} (${bowlerScore.bowlerId})`);
                const insertBowler: InsertBowler = {
                  name: bowlerScore.bowlerName,
                  email: `${bowlerScore.bowlerId}@placeholder.com`,
                  qubicaId: bowlerScore.bowlerId,
                  active: true,
                  order: 0,
                };

                bowler = await storage.createBowler(insertBowler);
                console.log('[ScoreImport] Created new bowler:', bowler);

                // Verify bowler was created successfully
                if (!bowler || !bowler.id) {
                  throw new Error(`Failed to create bowler: ${bowlerScore.bowlerName}`);
                }
              }

              bowlerCache.set(bowlerScore.bowlerId, bowler);
            }

            // Verify we have valid bowler before proceeding
            if (!bowler || !bowler.id) {
              throw new Error(`Invalid bowler object for ID: ${bowlerScore.bowlerId}`);
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
              laneNumber: bowlerScore.laneNumber,
            };

            scores.push(insertScore);
            console.log(`[ScoreImport] Added score:`, {
              gameId: game.id,
              bowlerId: bowler.id,
              teamId: team.id,
              score: bowlerScore.score,
              status: bowlerScore.status
            });
          } catch (error) {
            console.error(`[ScoreImport] Error processing bowler ${bowlerScore.bowlerName}:`, error);
            throw error;
          }
        }
      }

      // Log scores before batch creation
      console.log(`[ScoreImport] Preparing to create ${scores.length} scores across ${createdGames.length} games`);
      console.log('[ScoreImport] Score distribution by game:');
      const scoresByGame = scores.reduce((acc, score) => {
        acc[score.gameId] = (acc[score.gameId] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      console.log(scoresByGame);

      try {
        const createdScores = await storage.createBatchScores(scores);
        console.log('[ScoreImport] Successfully created all scores:', createdScores.length);
        return {
          gamesCreated: createdGames.length,
          scoresCreated: createdScores.length,
        };
      } catch (error) {
        console.error('[ScoreImport] Error creating batch scores:', error);
        throw error;
      }
    } catch (error) {
      console.error('[ScoreImport] Fatal error during score import:', error);
      throw error;
    }
  }
}