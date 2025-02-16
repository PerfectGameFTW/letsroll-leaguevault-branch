import { useQuery } from "@tanstack/react-query";
import type { Game, League, ApiResponse } from "@shared/schema";
import type { ScoreWithRelations } from "@/lib/types/scores";

interface UseLeagueScoresProps {
  leagueId: number;
  weekNumber?: number;
}

export function useLeagueScores({ leagueId, weekNumber }: UseLeagueScoresProps) {
  // Fetch league details
  const { data: leagueResponse, isLoading: loadingLeague, error: leagueError } = useQuery({
    queryKey: [`/api/leagues/${leagueId}`],
    queryFn: async () => {
      const response = await fetch(`/api/leagues/${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch league details');
      }
      return response.json() as Promise<ApiResponse<League>>;
    }
  });

  // Fetch scores for the week
  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery({
    queryKey: [`/api/scores/league/${leagueId}/week/${weekNumber}`],
    queryFn: async () => {
      if (!weekNumber) throw new Error('Week number is required');

      const response = await fetch(`/api/scores/league/${leagueId}/week/${weekNumber}`);
      if (!response.ok) {
        throw new Error('Failed to fetch scores');
      }
      return response.json() as Promise<ApiResponse<ScoreWithRelations[]>>;
    },
    enabled: !!weekNumber
  });

  return {
    league: leagueResponse?.data,
    scores: scoresResponse?.data ?? [],
    isLoading: loadingLeague || loadingScores,
    error: leagueError || scoresError
  };
}