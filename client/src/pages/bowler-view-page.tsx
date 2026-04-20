import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { ArrowLeft } from "lucide-react";
import { PageLoadingState } from "@/components/page-states";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { Payment, Team, League, BowlerDetailsResponse, ApiResponse } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { calculateBowlerViewFinancials } from "@/lib/financial-utils";
import { filterActiveBowlerLeagues } from "@/lib/bowler-league-utils";
import { BowlerFinancialSummary } from "@/components/bowler-financial-summary";
import { BowlerPaymentHistoryTable } from "@/components/bowler-payment-history-table";

export default function BowlerViewPage() {
  const params = useParams();
  const { toast } = useToast();
  const bowlerId = parseInt(params.bowlerId!);
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null);

  const { data: detailsResponse, isLoading: loadingDetails } = useQuery<ApiResponse<BowlerDetailsResponse>>({
    queryKey: [`/api/bowlers/${bowlerId}/details`],
    staleTime: 1000 * 60 * 5,
    retry: false,
    enabled: !isNaN(bowlerId),
  });

  const bowler = detailsResponse?.data?.bowler;
  const detailsLeagues = detailsResponse?.data?.leagues || [];
  const detailsTeams = detailsResponse?.data?.teams || [];

  const bowlerLeagues = useMemo(() => {
    const allLeagues = detailsResponse?.data?.bowlerLeagues || [];
    return filterActiveBowlerLeagues(allLeagues, bowlerId);
  }, [detailsResponse?.data?.bowlerLeagues, bowlerId]);

  const [addLeagueId, setAddLeagueId] = useState<number | null>(null);
  const [addTeamId, setAddTeamId] = useState<number | null>(null);
  const [showAddLeagueDialog, setShowAddLeagueDialog] = useState(false);

  const { data: leaguesResponse } = useQuery<ApiResponse<League[]>>({
    queryKey: ["/api/leagues"],
    staleTime: 1000 * 60 * 30,
    retry: false,
    enabled: showAddLeagueDialog,
  });
  const leagues = leaguesResponse?.data || [];

  const { data: allTeamsResponse } = useQuery<ApiResponse<Team[]>>({
    queryKey: ["/api/teams"],
    staleTime: 1000 * 60 * 15,
    retry: false,
    enabled: showAddLeagueDialog,
  });
  const allTeams = allTeamsResponse?.data || [];

  const availableLeagues = useMemo(() => {
    const assignedLeagueIds = new Set(bowlerLeagues.map(bl => bl.leagueId));
    return leagues.filter(l => l.active && !assignedLeagueIds.has(l.id));
  }, [leagues, bowlerLeagues]);

  const teamsForAddLeague = useMemo(() => {
    if (!addLeagueId) return [];
    return allTeams.filter(t => t.leagueId === addLeagueId);
  }, [allTeams, addLeagueId]);

  const selectedAssociation = useMemo(() => {
    return bowlerLeagues.find(bl =>
      bl.leagueId === selectedLeagueId &&
      bl.active &&
      bl.bowlerId === bowlerId
    );
  }, [bowlerLeagues, selectedLeagueId, bowlerId]);

  const team = useMemo(() => {
    if (!selectedAssociation?.teamId) return undefined;
    return detailsTeams.find(t => t.id === selectedAssociation.teamId);
  }, [detailsTeams, selectedAssociation?.teamId]);

  const league = useMemo(() => {
    if (!selectedLeagueId) return undefined;
    return detailsLeagues.find(l => l.id === selectedLeagueId);
  }, [detailsLeagues, selectedLeagueId]);

  const { data: paymentsResponse } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ["/api/payments", { bowlerId, leagueId: selectedLeagueId }],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.set("bowlerId", String(bowlerId));
      params.set("leagueId", String(selectedLeagueId));
      const response = await fetch(`/api/payments?${params.toString()}`, {
        credentials: "include",
        headers: { "Accept": "application/json" },
        signal,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || "Failed to fetch payments");
      }
      return response.json();
    },
    enabled: !!selectedLeagueId && !!bowlerId,
    staleTime: 1000 * 60,
    retry: false,
  });

  const payments = paymentsResponse?.data || [];

  const { data: bnStatusResponse } = useQuery<ApiResponse<{ configured: boolean }>>({
    queryKey: ["/api/bn/status"],
    staleTime: 1000 * 60 * 30,
    retry: false,
  });
  const bnConfigured = bnStatusResponse?.data?.configured || false;

  const bnSyncMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/bn/sync-bowler/${bowlerId}`, "POST");
    },
    onSuccess: () => {
      toast({ title: "Synced to BowlNow", description: `${bowler?.name} has been synced to BowlNow.` });
      queryClient.invalidateQueries({ queryKey: [`/api/bowlers/${bowlerId}/details`] });
    },
    onError: (error: Error) => {
      toast({ title: "Sync Failed", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (bowlerLeagues?.length && !selectedLeagueId) {
      setSelectedLeagueId(bowlerLeagues[0].leagueId);
    }
  }, [bowlerLeagues, selectedLeagueId]);

  const addToLeagueMutation = useMutation({
    mutationFn: async () => {
      if (!addLeagueId || !addTeamId) throw new Error("Select a league and team");
      return apiRequest("/api/bowler-leagues", "POST", {
        bowlerId,
        leagueId: addLeagueId,
        teamId: addTeamId,
        active: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bowler-leagues"] });
      queryClient.invalidateQueries({ queryKey: [`/api/bowlers/${bowlerId}/details`] });
      setAddLeagueId(null);
      setAddTeamId(null);
      setShowAddLeagueDialog(false);
      toast({ title: "Success", description: "Bowler added to league" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Suppress unused-variable warnings for state preserved for upcoming UI
  void availableLeagues;
  void teamsForAddLeague;
  void bnSyncMutation;
  void addToLeagueMutation;
  void setShowAddLeagueDialog;
  void setAddLeagueId;
  void setAddTeamId;

  if (loadingDetails) {
    return <Layout><PageLoadingState /></Layout>;
  }

  if (!bowler) {
    return <Layout><div className="text-center">Bowler not found</div></Layout>;
  }

  const financials = calculateBowlerViewFinancials(league, payments);

  return (
    <Layout>
      <div className="mb-6">
        {selectedAssociation && (
          <Link
            href={`/teams/${selectedAssociation.teamId}`}
            className="text-muted-foreground hover:text-foreground flex items-center mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Team
          </Link>
        )}
        <div className="flex flex-col gap-2 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{bowler?.name}</h1>
              <Badge variant={bowler?.active ? "default" : "secondary"}>
                {bowler?.active ? "Active" : "Inactive"}
              </Badge>
              {bnConfigured && (
                <Badge
                  variant={bowler?.bnContactId ? "default" : "outline"}
                  className={bowler?.bnContactId ? "bg-green-600" : ""}
                >
                  {bowler?.bnContactId ? "BN Synced" : "BN Not Synced"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2"></div>
          </div>
          <div className="flex flex-col gap-1">
            <Select
              value={selectedLeagueId?.toString() || ""}
              onValueChange={(value) => setSelectedLeagueId(parseInt(value))}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Select a league" />
              </SelectTrigger>
              <SelectContent>
                {bowlerLeagues.map((bl) => {
                  const leagueInfo = detailsLeagues?.find(l => l.id === bl.leagueId);
                  return leagueInfo ? (
                    <SelectItem key={bl.leagueId} value={bl.leagueId.toString()}>
                      {leagueInfo.name}
                    </SelectItem>
                  ) : null;
                })}
              </SelectContent>
            </Select>
            {team && (
              <div className="font-medium text-muted-foreground">{team.name}</div>
            )}
          </div>
        </div>

        <ErrorBoundary level="section">
          <BowlerFinancialSummary league={league} financials={financials} />
        </ErrorBoundary>
      </div>

      <ErrorBoundary level="section">
        <BowlerPaymentHistoryTable payments={payments} />
      </ErrorBoundary>
    </Layout>
  );
}
