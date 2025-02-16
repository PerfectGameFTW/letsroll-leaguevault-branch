import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Game, League, ApiResponse } from "@shared/schema";
import type { WeeklyScores } from "@/lib/types/scores";

interface UseLeagueScoresProps {
  leagueId: number;
  weekNumber?: number;
}

// Cache time constants
const LEAGUE_CACHE_TIME = 1000 * 60 * 60; // 1 hour
const GAMES_CACHE_TIME = 1000 * 60 * 5;   // 5 minutes
const SCORES_CACHE_TIME = 1000 * 60 * 5;  // 5 minutes

export function useLeagueScores({ leagueId, weekNumber }: UseLeagueScoresProps) {
  // Fetch all games for the league to get available weeks
  const { data: gamesResponse, isLoading: loadingGames, error: gamesError } = useQuery({
    queryKey: ["/api/games/league", leagueId] as const,
    queryFn: async () => {
      console.log('[useLeagueScores] Fetching games for league:', leagueId);
      try {
        const response = await fetch(`/api/games/league/${leagueId}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(errorData.message || `Failed to fetch games (${response.status})`);
        }
        const data = await response.json() as ApiResponse<Game[]>;
        console.log('[useLeagueScores] Received games:', data.data?.length || 0);
        return data;
      } catch (error) {
        console.error('[useLeagueScores] Error fetching games:', error);
        throw error;
      }
    },
    enabled: !!leagueId,
    gcTime: GAMES_CACHE_TIME * 2,
    staleTime: GAMES_CACHE_TIME,
  });

  // Fetch scores for the selected week
  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery({
    queryKey: ["/api/scores/league", leagueId, weekNumber] as const,
    queryFn: async () => {
      if (!weekNumber) {
        return { data: null, success: true, message: 'No week selected' };
      }
      console.log('[useLeagueScores] Fetching scores:', { leagueId, weekNumber });
      try {
        const response = await fetch(`/api/scores/league/${leagueId}/week/${weekNumber}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          console.error('[useLeagueScores] API error:', {
            status: response.status,
            error: errorData
          });
          throw new Error(errorData.message || `Failed to fetch scores (${response.status})`);
        }
        const data = await response.json() as ApiResponse<WeeklyScores>;
        console.log('[useLeagueScores] Received scores:', {
          success: data.success,
          teamCount: data.data?.teams?.length || 0
        });
        return data;
      } catch (error) {
        console.error('[useLeagueScores] Error fetching scores:', error);
        throw new Error(`Failed to fetch scores for league ${leagueId}, week ${weekNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
    enabled: !!leagueId && !!weekNumber,
    gcTime: SCORES_CACHE_TIME * 2,
    staleTime: SCORES_CACHE_TIME,
  });

  // Fetch league details with longer cache time since they rarely change
  const { data: leagueResponse, isLoading: loadingLeague, error: leagueError } = useQuery({
    queryKey: ["/api/leagues", leagueId] as const,
    queryFn: async () => {
      console.log('[useLeagueScores] Fetching league details:', leagueId);
      try {
        const response = await fetch(`/api/leagues/${leagueId}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(errorData.message || `Failed to fetch league (${response.status})`);
        }
        const data = await response.json() as ApiResponse<League>;
        console.log('[useLeagueScores] Received league:', data.data?.name);
        return data;
      } catch (error) {
        console.error('[useLeagueScores] Error fetching league:', error);
        throw error;
      }
    },
    enabled: !!leagueId,
    gcTime: LEAGUE_CACHE_TIME * 2,
    staleTime: LEAGUE_CACHE_TIME,
  });

  // Extract unique week numbers and sort them in descending order
  const weeks = useMemo(() => {
    const weekNumbers = Array.from(new Set(
      (gamesResponse?.data ?? []).map((g: Game) => g.weekNumber)
    )).sort((a, b) => b - a);
    console.log('[useLeagueScores] Available weeks:', weekNumbers);
    return weekNumbers;
  }, [gamesResponse?.data]);

  return {
    games: gamesResponse?.data ?? [],
    scores: scoresResponse?.data,
    league: leagueResponse?.data,
    weeks,
    isLoading: loadingGames || loadingScores || loadingLeague,
    errors: [
      { type: 'league', error: leagueError },
      { type: 'games', error: gamesError },
      { type: 'scores', error: scoresError },
    ].filter(e => e.error),
    loadingMessage: loadingScores ? "Loading scores..." : "",
    errorMessage: scoresError ? `Error loading scores: ${scoresError instanceof Error ? scoresError.message : 'Unknown error'}` : ""
  };
}