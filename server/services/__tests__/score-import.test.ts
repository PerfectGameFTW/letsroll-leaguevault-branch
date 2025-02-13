import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../../storage', () => ({
  storage: {
    getLeague: jest.fn(),
    createGame: jest.fn(),
    getBowlerByQubicaId: jest.fn(),
    createBowler: jest.fn(),
    getTeamByNumber: jest.fn(),
    createBatchScores: jest.fn(),
  }
}));

import { ScoreImportService, ScoreImportError } from '../score-import';
import { storage } from '../../storage';
import type { Game, Team, Bowler, Score } from '@shared/schema';

describe('ScoreImportService', () => {
  // Use a relative path from the test file to the sample data
  const testDataPath = join(__dirname, '../../../attached_assets/bls_farmmxd_24_25__Conquerer X__wk020.S00');
  const sampleFileContent = readFileSync(testDataPath, 'utf-8');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('successfully imports scores for all three games', async () => {
    // Mock successful league fetch
    (storage.getLeague as jest.Mock).mockResolvedValue({
      id: 1,
      name: 'Test League',
      qubicaId: null,
    });

    // Store created games for verification
    const createdGames: Game[] = [];
    (storage.createGame as jest.Mock).mockImplementation((game): Game => {
      const createdGame = {
        ...game,
        id: createdGames.length + 1,
      };
      createdGames.push(createdGame);
      return createdGame;
    });

    // Mock team lookup
    (storage.getTeamByNumber as jest.Mock).mockImplementation((leagueId: number, number: number): Team => ({
      id: number,
      number,
      leagueId,
      name: `Team ${number}`,
      active: true,
    }));

    // Mock bowler lookup/creation
    const bowlerCache = new Map<string, Bowler>();
    (storage.getBowlerByQubicaId as jest.Mock).mockImplementation((qubicaId: string): Bowler => {
      if (!bowlerCache.has(qubicaId)) {
        bowlerCache.set(qubicaId, {
          id: parseInt(qubicaId),
          name: `Bowler ${qubicaId}`,
          email: `bowler${qubicaId}@example.com`,
          qubicaId,
          active: true,
          order: 0,
          squareCustomerId: null,
        });
      }
      return bowlerCache.get(qubicaId)!;
    });

    // Store created scores for verification
    const createdScores: Score[] = [];
    (storage.createBatchScores as jest.Mock).mockImplementation((scores) => {
      createdScores.push(...scores);
      return scores;
    });

    const service = new ScoreImportService(1);
    const result = await service.importScoreFile(sampleFileContent);

    // Verify games are created with sequential game numbers
    expect(createdGames).toHaveLength(3);
    createdGames.forEach((game, index) => {
      expect(game.gameNumber).toBe(index + 1);
      expect(game.weekNumber).toBe(20); // Week number from the test file
    });

    // Verify scores are created for each game
    const scoresByGame = createdScores.reduce((acc, score) => {
      if (!acc[score.gameId]) {
        acc[score.gameId] = [];
      }
      acc[score.gameId].push(score);
      return acc;
    }, {} as Record<number, Score[]>);

    // Verify each game has scores
    expect(Object.keys(scoresByGame)).toHaveLength(3);

    // Check that scores are distributed across all games
    Object.entries(scoresByGame).forEach(([gameId, scores]) => {
      const gameScores = scores.length;
      expect(gameScores).toBeGreaterThan(0);
      console.log(`Game ${gameId} has ${gameScores} scores`);
    });

    // Verify team consistency across games
    const teamIds = new Set(createdScores.map(s => s.teamId));
    teamIds.forEach(teamId => {
      // Each team should have scores in all three games
      const teamScores = createdScores.filter(s => s.teamId === teamId);
      const teamGameIds = new Set(teamScores.map(s => s.gameId));
      expect(teamGameIds.size).toBe(3); // Each team should have scores in all 3 games
    });

    expect(result.gamesCreated).toBe(3);
    expect(result.scoresCreated).toBeGreaterThan(0);
  });

  it('throws error when league is not found', async () => {
    (storage.getLeague as jest.Mock).mockResolvedValue(null);

    const service = new ScoreImportService(999);
    await expect(service.importScoreFile(sampleFileContent))
      .rejects
      .toThrow(new ScoreImportError('League not found', 'LEAGUE_NOT_FOUND'));
  });
});