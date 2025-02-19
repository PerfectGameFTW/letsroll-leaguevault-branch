import { useQuery } from "@tanstack/react-query";
import type { League, ApiResponse } from "@shared/schema";
import type { ScoreWithRelations } from "@/lib/types/scores";

interface UseLeagueScoresProps {
  leagueId: number;
  weekNumber?: number;
}

interface UseLeagueScoresReturn {
  league?: League;
  scores: ScoreWithRelations[];
  isLoading: boolean;
  error: Error | null;
}

export function useLeagueScores({ leagueId, weekNumber }: UseLeagueScoresProps): UseLeagueScoresReturn {
  // Fetch league details with optimized caching
  const { data: leagueResponse, isLoading: loadingLeague, error: leagueError } = useQuery<ApiResponse<League>>({
    queryKey: [`/api/leagues/${leagueId}`],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/leagues/${leagueId}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || 'Failed to fetch league details');
        }
        return response.json();
      } catch (error) {
        console.error('[useLeagueScores] League fetch error:', error);
        throw error;
      }
    },
    staleTime: 1000 * 60 * 15, // Cache for 15 minutes as league data changes infrequently
    gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Fetch scores with optimized querying and error handling
  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery<ApiResponse<ScoreWithRelations[]>>({
    queryKey: ['/api/scores/league', leagueId, weekNumber],
    queryFn: async () => {
      if (!weekNumber) throw new Error('Week number is required');

      try {
        const response = await fetch(`/api/scores/league/${leagueId}/week/${weekNumber}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: { message: 'Failed to fetch scores' } }));
          throw new Error(errorData.error?.message || 'Failed to fetch scores');
        }
        return response.json();
      } catch (error) {
        console.error('[useLeagueScores] Scores fetch error:', error);
        throw error;
      }
    },
    enabled: !!weekNumber,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes as scores may update more frequently
    gcTime: 1000 * 60 * 15, // Keep in cache for 15 minutes
    retry: 2,
  });

  // Combine and format errors
  const error = leagueError || scoresError ? new Error((leagueError || scoresError)?.message) : null;

  return {
    league: leagueResponse?.data,
    scores: scoresResponse?.data ?? [],
    isLoading: loadingLeague || loadingScores,
    error
  };
}