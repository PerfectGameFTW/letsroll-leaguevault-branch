import { parseQubicaScoreFile } from '../../utils/qubica-parser';
import { ScoreImportService, ScoreImportError } from '../score-import';
import { storage } from '../../storage';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Mock storage methods
jest.mock('../../storage', () => ({
  storage: {
    getLeague: jest.fn(),
    createGame: jest.fn(),
    getBowlerByQubicaId: jest.fn(),
    createBowler: jest.fn(),
    getTeamByNumber: jest.fn(),
    createBatchScores: jest.fn(),
  },
}));

describe('ScoreImportService', () => {
  const currentFilePath = fileURLToPath(import.meta.url);
  const testDataPath = join(dirname(currentFilePath), '../../../attached_assets/bls_farmmxd_24_25__Conquerer X__wk020.S00');
  const sampleFileContent = readFileSync(testDataPath, 'utf-8');
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('successfully imports scores when all data is valid', async () => {
    // Mock successful league fetch
    (storage.getLeague as jest.Mock).mockResolvedValue({
      id: 1,
      name: 'Test League',
      qubicaId: null,
    });

    // Mock game creation
    (storage.createGame as jest.Mock).mockImplementation((game) => ({
      ...game,
      id: Math.floor(Math.random() * 1000),
    }));

    // Mock team lookup
    (storage.getTeamByNumber as jest.Mock).mockImplementation((leagueId, number) => ({
      id: number,
      number,
      leagueId,
      name: `Team ${number}`,
    }));

    // Mock bowler lookup/creation
    (storage.getBowlerByQubicaId as jest.Mock).mockImplementation((qubicaId) => ({
      id: parseInt(qubicaId),
      name: `Bowler ${qubicaId}`,
      qubicaId,
    }));

    // Mock score creation
    (storage.createBatchScores as jest.Mock).mockImplementation((scores) => scores);

    const service = new ScoreImportService(1);
    const result = await service.importScoreFile(sampleFileContent);

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

  it('throws error when QubicaAMF league ID mismatches', async () => {
    (storage.getLeague as jest.Mock).mockResolvedValue({
      id: 1,
      name: 'Test League',
      qubicaId: 'DIFFERENT_ID',
    });

    const service = new ScoreImportService(1);
    await expect(service.importScoreFile(sampleFileContent))
      .rejects
      .toThrow(new ScoreImportError('QubicaAMF league ID mismatch', 'LEAGUE_ID_MISMATCH'));
  });

  it('skips teams that do not exist in the database', async () => {
    // Mock successful league fetch
    (storage.getLeague as jest.Mock).mockResolvedValue({
      id: 1,
      name: 'Test League',
      qubicaId: null,
    });

    // Mock game creation
    (storage.createGame as jest.Mock).mockImplementation((game) => ({
      ...game,
      id: Math.floor(Math.random() * 1000),
    }));

    // Mock team lookup to return null for some teams
    (storage.getTeamByNumber as jest.Mock).mockImplementation((leagueId, number) => 
      number % 2 === 0 ? null : {
        id: number,
        number,
        leagueId,
        name: `Team ${number}`,
      }
    );

    const service = new ScoreImportService(1);
    const result = await service.importScoreFile(sampleFileContent);

    expect(result.gamesCreated).toBe(3);
    expect(result.scoresCreated).toBeGreaterThan(0);
    
    // Verify that createBatchScores was only called with scores for existing teams
    const createBatchScoresCalls = (storage.createBatchScores as jest.Mock).mock.calls;
    createBatchScoresCalls.forEach(([scores]) => {
      scores.forEach((score: any) => {
        expect(score.teamId % 2).toBe(1); // Only odd team IDs should be present
      });
    });
  });

  it('creates new bowlers when they do not exist', async () => {
    // Mock successful league fetch
    (storage.getLeague as jest.Mock).mockResolvedValue({
      id: 1,
      name: 'Test League',
      qubicaId: null,
    });

    // Mock game creation
    (storage.createGame as jest.Mock).mockImplementation((game) => ({
      ...game,
      id: Math.floor(Math.random() * 1000),
    }));

    // Mock team lookup
    (storage.getTeamByNumber as jest.Mock).mockImplementation((leagueId, number) => ({
      id: number,
      number,
      leagueId,
      name: `Team ${number}`,
    }));

    // Mock bowler lookup to return null
    (storage.getBowlerByQubicaId as jest.Mock).mockResolvedValue(null);

    // Mock bowler creation
    (storage.createBowler as jest.Mock).mockImplementation((bowler) => ({
      ...bowler,
      id: Math.floor(Math.random() * 1000),
    }));

    const service = new ScoreImportService(1);
    await service.importScoreFile(sampleFileContent);

    // Verify that createBowler was called for each new bowler
    expect(storage.createBowler).toHaveBeenCalled();
    const createBowlerCalls = (storage.createBowler as jest.Mock).mock.calls;
    createBowlerCalls.forEach(([bowler]) => {
      expect(bowler).toHaveProperty('name');
      expect(bowler).toHaveProperty('email');
      expect(bowler).toHaveProperty('qubicaId');
    });
  });
});
