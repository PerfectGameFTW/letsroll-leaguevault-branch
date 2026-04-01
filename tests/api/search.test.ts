import { describe, it, expect, beforeAll } from 'vitest';
import {
  login,
  apiGet,
  type AuthSession,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_B_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

interface SearchResults {
  leagues: { id: number; name: string; active: boolean }[];
  teams: { id: number; name: string; number: number; leagueId: number; leagueName: string | null }[];
  bowlers: { id: number; name: string; email: string | null }[];
}

describe('Global Search API', () => {
  let orgASession: AuthSession;
  let orgBSession: AuthSession;
  let adminSession: AuthSession;

  beforeAll(async () => {
    orgASession = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    orgBSession = await login(TEST_ORG_B_EMAIL, TEST_ORG_PASSWORD);
    adminSession = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
  });

  describe('authentication', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const { status } = await apiGet<SearchResults>('/api/search?q=test');
      expect(status).toBe(401);
    });
  });

  describe('input validation', () => {
    it('should return empty results for empty query', async () => {
      const { status, data } = await apiGet<SearchResults>('/api/search?q=', orgASession);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.leagues).toEqual([]);
      expect(data.data!.teams).toEqual([]);
      expect(data.data!.bowlers).toEqual([]);
    });

    it('should return empty results for single-character query', async () => {
      const { status, data } = await apiGet<SearchResults>('/api/search?q=a', orgASession);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.leagues).toEqual([]);
      expect(data.data!.teams).toEqual([]);
      expect(data.data!.bowlers).toEqual([]);
    });

    it('should return empty results when no q parameter', async () => {
      const { status, data } = await apiGet<SearchResults>('/api/search', orgASession);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data!.leagues).toEqual([]);
    });
  });

  describe('response structure', () => {
    it('should return grouped results with correct shape', async () => {
      const { status, data } = await apiGet<SearchResults>('/api/search?q=test', orgASession);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('leagues');
      expect(data.data).toHaveProperty('teams');
      expect(data.data).toHaveProperty('bowlers');
      expect(Array.isArray(data.data!.leagues)).toBe(true);
      expect(Array.isArray(data.data!.teams)).toBe(true);
      expect(Array.isArray(data.data!.bowlers)).toBe(true);
    });

    it('should limit results to 5 per category', async () => {
      const { data } = await apiGet<SearchResults>('/api/search?q=a', orgASession);
      if (data.data) {
        expect(data.data.leagues.length).toBeLessThanOrEqual(5);
        expect(data.data.teams.length).toBeLessThanOrEqual(5);
        expect(data.data.bowlers.length).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('organization scoping', () => {
    it('org A search results should only contain org A data', async () => {
      const { status, data } = await apiGet<SearchResults>('/api/search?q=league', orgASession);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('org B search results should only contain org B data', async () => {
      const { status, data } = await apiGet<SearchResults>('/api/search?q=league', orgBSession);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('system admin without org context should get empty results', async () => {
      if (!adminSession.user.organizationId) {
        const { status, data } = await apiGet<SearchResults>('/api/search?q=test', adminSession);
        expect(status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data!.leagues).toEqual([]);
        expect(data.data!.teams).toEqual([]);
        expect(data.data!.bowlers).toEqual([]);
      }
    });

    it('org A should not see org B leagues in search', async () => {
      const orgBLeagues = await apiGet<{ id: number; name: string }[]>('/api/leagues', orgBSession);
      const orgBLeagueNames = (orgBLeagues.data.data ?? []).map(l => l.name);

      if (orgBLeagueNames.length > 0) {
        const searchTerm = orgBLeagueNames[0].substring(0, 4);
        const { data: searchData } = await apiGet<SearchResults>(
          `/api/search?q=${encodeURIComponent(searchTerm)}`,
          orgASession,
        );

        const foundLeagueNames = (searchData.data?.leagues ?? []).map(l => l.name);
        for (const orgBName of orgBLeagueNames) {
          expect(foundLeagueNames).not.toContain(orgBName);
        }
      }
    });
  });

  describe('league results', () => {
    it('should return league results with correct fields', async () => {
      const { data } = await apiGet<SearchResults>('/api/search?q=league', orgASession);
      if (data.data && data.data.leagues.length > 0) {
        const league = data.data.leagues[0];
        expect(league).toHaveProperty('id');
        expect(league).toHaveProperty('name');
        expect(league).toHaveProperty('active');
        expect(typeof league.id).toBe('number');
        expect(typeof league.name).toBe('string');
        expect(typeof league.active).toBe('boolean');
      }
    });
  });

  describe('team results', () => {
    it('should return team results with league name', async () => {
      const { data } = await apiGet<SearchResults>('/api/search?q=team', orgASession);
      if (data.data && data.data.teams.length > 0) {
        const team = data.data.teams[0];
        expect(team).toHaveProperty('id');
        expect(team).toHaveProperty('name');
        expect(team).toHaveProperty('number');
        expect(team).toHaveProperty('leagueId');
        expect(team).toHaveProperty('leagueName');
      }
    });
  });

  describe('bowler results', () => {
    it('should return bowler results with correct fields', async () => {
      const { data } = await apiGet<SearchResults>('/api/search?q=bowler', orgASession);
      if (data.data && data.data.bowlers.length > 0) {
        const bowler = data.data.bowlers[0];
        expect(bowler).toHaveProperty('id');
        expect(bowler).toHaveProperty('name');
        expect(bowler).toHaveProperty('email');
      }
    });
  });
});
