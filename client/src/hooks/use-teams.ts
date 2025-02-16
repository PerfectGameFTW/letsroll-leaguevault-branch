import { useQuery } from "@tanstack/react-query";
import type { Team, ApiResponse } from "@shared/schema";

interface UseTeamsOptions {
  leagueId: number;
  enabled?: boolean;
}

export function useTeams({ leagueId, enabled = true }: UseTeamsOptions) {
  const { data: teamsResponse, isLoading, error } = useQuery<ApiResponse<Team[]>>({
    queryKey: ["/api/teams", leagueId],
    queryFn: async () => {
      const response = await fetch(`/api/teams?leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch teams');
      }
      return response.json();
    },
    enabled: enabled && !!leagueId,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const teams = teamsResponse?.data ?? [];
  const nextTeamNumber = teams.length > 0
    ? Math.max(...teams.map(t => t.number || 0)) + 1
    : 1;

  return {
    teams,
    nextTeamNumber,
    isLoading,
    error
  };
}
