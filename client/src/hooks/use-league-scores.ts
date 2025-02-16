import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Game, League, ApiResponse } from "@shared/schema";
import type { ScoreWithRelations } from "@/lib/types/scores";

interface UseLeagueScoresProps {
  leagueId: number;
  weekNumber?: number;
}

export function useLeagueScores({ leagueId, weekNumber }: UseLeagueScoresProps) {
  // Fetch all games for the league to get available weeks
  const { data: gamesResponse, isLoading: loadingGames, error: gamesError } = useQuery<ApiResponse<Game[]>>({
    queryKey: ["/api/games", { leagueId }],
    queryFn: async () => {
      console.log('[useLeagueScores] Fetching games for league:', leagueId);
      try {
        const response = await fetch(`/api/games?leagueId=${leagueId}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(errorData.message || `Failed to fetch games (${response.status})`);
        }
        const data = await response.json();
        console.log('[useLeagueScores] Received games:', data.data?.length || 0);
        return data;
      } catch (error) {
        console.error('[useLeagueScores] Error fetching games:', error);
        throw error;
      }
    },
    enabled: !!leagueId,
  });

  // Fetch scores for the selected week
  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery<ApiResponse<ScoreWithRelations[]>>({
    queryKey: ["/api/scores", { leagueId, weekNumber }],
    queryFn: async () => {
      if (!weekNumber) throw new Error('No week selected');
      console.log('[useLeagueScores] Fetching scores for league:', leagueId, 'week:', weekNumber);
      try {
        const response = await fetch(`/api/scores/league/${leagueId}/week/${weekNumber}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(errorData.message || `Failed to fetch scores (${response.status})`);
        }
        const data = await response.json();
        console.log('[useLeagueScores] Received scores:', data.data?.length || 0);
        return data;
      } catch (error) {
        console.error('[useLeagueScores] Error fetching scores:', error);
        throw error;
      }
    },
    enabled: !!leagueId && !!weekNumber,
  });

  // Fetch league details
  const { data: leagueResponse, isLoading: loadingLeague, error: leagueError } = useQuery<ApiResponse<League>>({
    queryKey: [`/api/leagues/${leagueId}`],
    queryFn: async () => {
      console.log('[useLeagueScores] Fetching league details:', leagueId);
      try {
        const response = await fetch(`/api/leagues/${leagueId}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(errorData.message || `Failed to fetch league (${response.status})`);
        }
        const data = await response.json();
        console.log('[useLeagueScores] Received league:', data.data?.name);
        return data;
      } catch (error) {
        console.error('[useLeagueScores] Error fetching league:', error);
        throw error;
      }
    },
    enabled: !!leagueId,
  });

  // Extract unique week numbers and sort them in descending order
  const weeks = useMemo(() => {
    const weekNumbers = Array.from(new Set((gamesResponse?.data ?? []).map(g => g.weekNumber))).sort((a, b) => b - a);
    console.log('[useLeagueScores] Available weeks:', weekNumbers);
    return weekNumbers;
  }, [gamesResponse?.data]);

  return {
    games: gamesResponse?.data ?? [],
    scores: scoresResponse?.data ?? [],
    league: leagueResponse?.data,
    weeks,
    isLoading: loadingGames || loadingScores || loadingLeague,
    errors: [
      { type: 'league', error: leagueError },
      { type: 'games', error: gamesError },
      { type: 'scores', error: scoresError },
    ].filter(e => e.error)
  };
}