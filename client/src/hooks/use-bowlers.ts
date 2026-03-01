import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bowler, Team, League, BowlerLeague, ApiResponse } from "@shared/schema";

interface UseBowlersOptions {
  showInactive?: boolean;
  searchQuery?: string;
  isEnabled?: boolean;
}

export function useBowlers({ showInactive = false, searchQuery = "", isEnabled = true }: UseBowlersOptions = {}) {
  // Query for bowlers with proper error handling and longer cache time
  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<ApiResponse<Bowler[]>>({
    queryKey: ["/api/bowlers"],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    enabled: isEnabled,
  });

  // Only fetch bowler leagues if we have bowlers
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<ApiResponse<BowlerLeague[]>>({
    queryKey: ["/api/bowler-leagues"],
    enabled: !!bowlersResponse?.data?.length && isEnabled,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  // Only fetch teams if we have bowler leagues that need team information
  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<ApiResponse<Team[]>>({
    queryKey: ["/api/teams"],
    enabled: !!bowlerLeaguesResponse?.data?.length && isEnabled,
    staleTime: 1000 * 60 * 15, // Cache for 15 minutes as team data changes less frequently
  });

  // Only fetch leagues if we have teams that need league information
  const { data: leaguesResponse, isLoading: loadingLeagues } = useQuery<ApiResponse<League[]>>({
    queryKey: ["/api/leagues"],
    enabled: !!teamsResponse?.data?.length && isEnabled,
    staleTime: 1000 * 60 * 30, // Cache for 30 minutes as league data changes very infrequently
  });

  const bowlers = bowlersResponse?.data ?? [];
  const bowlerLeagues = bowlerLeaguesResponse?.data ?? [];
  const teams = teamsResponse?.data ?? [];
  const leagues = leaguesResponse?.data ?? [];

  // Memoize filtered bowlers to avoid unnecessary recalculations
  const filteredBowlers = useMemo(() => {
    return bowlers.filter(bowler => {
      const matchesSearch = searchQuery === "" || 
        bowler.name.toLowerCase().includes(searchQuery.toLowerCase());
      return (showInactive ? true : bowler.active) && matchesSearch;
    });
  }, [bowlers, searchQuery, showInactive]);

  // Get first league name for a bowler (alphabetically ordered)
  const getBowlerFirstLeagueName = useMemo(() => (bowler: Bowler) => {
    const bowlerLeagueIds = bowlerLeagues
      .filter(bl => bl.bowlerId === bowler.id && bl.active)
      .map(bl => bl.leagueId);

    const bowlerLeagueNames = leagues
      .filter(league => bowlerLeagueIds.includes(league.id))
      .map(league => league.name)
      .sort();

    return bowlerLeagueNames[0] || "No League";
  }, [bowlerLeagues, leagues]);

  // Memoize bowler-team-league relationships to avoid recalculations
  const getBowlerTeam = useMemo(() => (bowler: Bowler) => {
    const activeBowlerLeague = bowlerLeagues.find(bl => 
      bl.bowlerId === bowler.id && 
      bl.active
    );
    if (!activeBowlerLeague) return undefined;

    return teams.find(t => t.id === activeBowlerLeague.teamId);
  }, [bowlerLeagues, teams]);

  const getWeeklyFee = useMemo(() => (bowler: Bowler) => {
    const team = getBowlerTeam(bowler);
    if (!team) return 0;

    const league = leagues.find(l => l.id === team.leagueId);
    return league?.weeklyFee ?? 0;
  }, [getBowlerTeam, leagues]);

  // Memoize bowler team name getter to avoid recalculations
  const getBowlerTeamName = useMemo(() => (bowler: Bowler) => {
    const team = getBowlerTeam(bowler);
    return team?.name || "No Team";
  }, [getBowlerTeam]);

  // Get first league ID for a bowler
  const getBowlerLeagueId = useMemo(() => (bowler: Bowler) => {
    const activeBowlerLeague = bowlerLeagues
      .find(bl => bl.bowlerId === bowler.id && bl.active);

    if (!activeBowlerLeague) return undefined;

    const team = teams.find(t => t.id === activeBowlerLeague.teamId);
    return team?.leagueId;
  }, [bowlerLeagues, teams]);

  // Show loading skeleton while initial data is being fetched
  const isInitialLoading = loadingBowlers && !bowlers.length;
  const isLoadingRelatedData = (loadingBowlerLeagues || loadingTeams || loadingLeagues) && bowlers.length > 0;

  return {
    bowlers: filteredBowlers,
    getBowlerTeam,
    getWeeklyFee,
    getBowlerFirstLeagueName,
    getBowlerTeamName,
    getBowlerLeagueId,
    isInitialLoading,
    isLoadingRelatedData,
  };
}