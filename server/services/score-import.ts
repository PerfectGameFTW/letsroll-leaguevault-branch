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
      console.log('[ScoreImport] Starting import process...');

      // Parse file content
      console.log('[ScoreImport] Parsing score file...');
      const parsedData = parseQubicaScoreFile(fileContent);

      // Log all team games and their lane assignments
      console.log('[ScoreImport] Team games found:', parsedData.games.map(game => ({
        gameNumber: game.gameNumber,
        teamNumber: game.teamNumber,
        teamName: game.teamName,
        laneNumber: game.laneNumber,
        bowlerCount: game.bowlers.length
      })));

      // Verify the parsed date
      if (!parsedData.header.date || isNaN(parsedData.header.date.getTime())) {
        console.error('[ScoreImport] Invalid date from parser:', parsedData.header.date);
        throw new ScoreImportError('Invalid date in score file', 'INVALID_DATE');
      }

      // Create a new Date object and format it properly for PostgreSQL
      const gameDate = new Date(parsedData.header.date);

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
            date: gameDate,
          };

          const game = await storage.createGame(insertGame);
          console.log(`[ScoreImport] Created game successfully:`, {
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

      // Group teams by lane numbers for verification
      const laneAssignments = new Map<number, { teamNumber: string, teamName: string }>();

      // Process each game from the parsed data
      console.log(`[ScoreImport] Processing ${parsedData.games.length} team games...`);
      for (const teamGame of parsedData.games) {
        const gameNumber = teamGame.gameNumber;
        laneAssignments.set(teamGame.laneNumber, {
          teamNumber: teamGame.teamNumber,
          teamName: teamGame.teamName
        });

        console.log(`[ScoreImport] Processing team game:`, {
          gameNumber,
          teamNumber: teamGame.teamNumber,
          teamName: teamGame.teamName,
          laneNumber: teamGame.laneNumber,
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
          console.log(`[ScoreImport] Looking up team number ${teamGame.teamNumber} for lane ${teamGame.laneNumber}`);
          team = await storage.getTeamByNumber(this.leagueId, parseInt(teamGame.teamNumber));
          if (!team) {
            console.warn(`[ScoreImport] Team number ${teamGame.teamNumber} not found in league ${this.leagueId}`);
            continue;
          }
          teamCache.set(teamGame.teamNumber, team);
        }

        // Process bowlers for this team and game
        console.log(`[ScoreImport] Processing ${teamGame.bowlers.length} bowlers for team ${team.name} on lane ${teamGame.laneNumber} game ${gameNumber}`);

        for (const bowlerScore of teamGame.bowlers) {
          try {
            // Get or cache bowler
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
            };

            scores.push(insertScore);
            console.log(`[ScoreImport] Added score:`, {
              gameId: game.id,
              bowlerId: bowler.id,
              teamId: team.id,
              score: bowlerScore.score,
              laneNumber: teamGame.laneNumber,
              status: bowlerScore.status
            });
          } catch (error) {
            console.error(`[ScoreImport] Error processing bowler ${bowlerScore.bowlerName}:`, error);
            throw error;
          }
        }
      }

      // Log lane assignments for verification
      console.log('[ScoreImport] Final lane assignments:', 
        Array.from(laneAssignments.entries())
          .sort(([a], [b]) => a - b)
          .map(([lane, team]) => `Lane ${lane}: Team ${team.teamNumber} (${team.teamName})`)
      );

      // Create all scores in a batch
      console.log(`[ScoreImport] Creating ${scores.length} scores in batch`);
      try {
        const createdScores = await storage.createBatchScores(scores);
        console.log('[ScoreImport] Successfully created all scores:', 
          createdScores.map(score => ({
            id: score.id,
            gameId: score.gameId,
            laneNumber: score.laneNumber,
            score: score.score
          }))
        );

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