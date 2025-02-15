import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../../storage.js', () => ({
  storage: {
    getLeague: jest.fn(),
    createGame: jest.fn(),
    getBowlerByQubicaId: jest.fn(),
    createBowler: jest.fn(),
    getTeamByNumber: jest.fn(),
    createBatchScores: jest.fn(),
  }
}));

import { ScoreImportService, ScoreImportError } from '../score-import.js';
import { storage } from '../../storage.js';
import type { League, Game, Team, Bowler, Score } from '@shared/schema';

describe('ScoreImportService', () => {
  const testDataPath = join(__dirname, '../../../attached_assets/bls_farmmxd_24_25__Conquerer X__wk020.S00');
  const sampleFileContent = readFileSync(testDataPath, 'utf-8');

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock league
    const mockLeague: League = {
      id: 1,
      name: 'Test League',
      description: 'Test League Description',
      active: true,
      seasonStart: new Date('2024-09-01'),
      seasonEnd: new Date('2025-05-31'),
      weekDay: 'Monday',
      weeklyFee: 2000,
      qubicaId: null,
      practiceStartTime: '18:00',
      competitionStartTime: '18:30'
    };
    (storage.getLeague as jest.Mock).mockResolvedValue(mockLeague);

    // Mock team lookup
    (storage.getTeamByNumber as jest.Mock).mockImplementation((leagueId: number, teamNumber: number): Team => ({
      id: teamNumber,
      name: `Team ${teamNumber}`,
      number: teamNumber,
      leagueId,
      active: true,
    }));

    // Store created games for verification
    const createdGames: Game[] = [];
    (storage.createGame as jest.Mock).mockImplementation((gameData: Partial<Game>): Game => {
      const createdGame = {
        id: createdGames.length + 1,
        ...gameData,
      } as Game;
      createdGames.push(createdGame);
      return createdGame;
    });

    // Store created scores for verification
    const createdScores: Score[] = [];
    (storage.createBatchScores as jest.Mock).mockImplementation((scores: Score[]) => {
      createdScores.push(...scores);
      return scores;
    });
  });

  it('successfully imports scores for all three games', async () => {
    const service = new ScoreImportService(1);

    // Log sample file content for debugging
    console.log('Sample file content first 200 chars:', sampleFileContent.substring(0, 200));
    console.log('Total file length:', sampleFileContent.length);

    const result = await service.importScoreFile(sampleFileContent);

    // Verify getLeague was called with correct ID
    expect(storage.getLeague).toHaveBeenCalledWith(1);

    // Verify three games were created
    expect(storage.createGame).toHaveBeenCalledTimes(3);
    const createGameCalls = (storage.createGame as jest.Mock).mock.calls;
    expect(createGameCalls).toHaveLength(3);

    // Verify game creation parameters
    createGameCalls.forEach((call: any, index: number) => {
      const gameData = call[0];
      expect(gameData).toMatchObject({
        leagueId: 1,
        weekNumber: 20, // Week number from the test file
        gameNumber: index + 1,
      });
    });

    // Verify scores were created
    expect(storage.createBatchScores).toHaveBeenCalled();
    const scores = (storage.createBatchScores as jest.Mock).mock.calls[0][0] as Score[];
    expect(scores.length).toBeGreaterThan(0);

    // Verify each team has scores in all games
    const scoresByTeam = new Map<number, Set<number>>();
    scores.forEach(score => {
      if (!scoresByTeam.has(score.teamId)) {
        scoresByTeam.set(score.teamId, new Set());
      }
      scoresByTeam.get(score.teamId)!.add(score.gameId);
    });

    // Each team should have scores in all three games
    scoresByTeam.forEach((gameIds, teamId) => {
      expect(gameIds.size).toBe(3);
    });

    // Log test results for debugging
    console.log('Test Results:', {
      gamesCreated: result.gamesCreated,
      scoresCreated: result.scoresCreated,
      uniqueTeams: scoresByTeam.size,
      teamsWithAllGames: Array.from(scoresByTeam.entries())
        .filter(([_, games]) => games.size === 3).length,
      scoresByTeam: Object.fromEntries(
        Array.from(scoresByTeam.entries()).map(([teamId, games]) => [
          teamId, 
          Array.from(games)
        ])
      )
    });
  });

  it('throws error when league is not found', async () => {
    (storage.getLeague as jest.Mock).mockResolvedValue(null);

    const service = new ScoreImportService(999);
    await expect(service.importScoreFile(sampleFileContent))
      .rejects
      .toThrow(new ScoreImportError('League not found', 'LEAGUE_NOT_FOUND'));
  });
});