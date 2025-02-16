import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Game, Score, League, ApiResponse } from "@shared/schema";

interface UseLeagueScoresProps {
  leagueId: number;
  weekNumber?: number;
}

export function useLeagueScores({ leagueId, weekNumber }: UseLeagueScoresProps) {
  const { data: gamesResponse, isLoading: loadingGames, error: gamesError } = useQuery<ApiResponse<Game[]>>({
    queryKey: ["/api/games", { leagueId }],
    queryFn: async () => {
      const response = await fetch(`/api/games?leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch games');
      }
      return response.json();
    },
    enabled: !!leagueId,
  });

  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery<ApiResponse<Score[]>>({
    queryKey: ["/api/scores", { leagueId, weekNumber }],
    queryFn: async () => {
      if (!weekNumber) throw new Error('No week selected');
      const response = await fetch(`/api/scores/league/${leagueId}/week/${weekNumber}`);
      if (!response.ok) {
        throw new Error('Failed to fetch scores');
      }
      return response.json();
    },
    enabled: !!leagueId && !!weekNumber,
  });

  const { data: leagueResponse, isLoading: loadingLeague, error: leagueError } = useQuery<ApiResponse<League>>({
    queryKey: [`/api/leagues/${leagueId}`],
    queryFn: async () => {
      const response = await fetch(`/api/leagues/${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch league');
      }
      return response.json();
    },
    enabled: !!leagueId,
  });

  const weeks = useMemo(() => 
    Array.from(new Set((gamesResponse?.data ?? []).map(g => g.weekNumber))).sort((a, b) => b - a),
    [gamesResponse?.data]
  );

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