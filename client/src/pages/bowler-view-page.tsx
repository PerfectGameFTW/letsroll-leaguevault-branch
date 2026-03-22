import { useState, useEffect, useMemo } from "react";  
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { ArrowLeft, ExternalLink, Plus, RefreshCw } from "lucide-react";
import { PageLoadingState } from "@/components/page-states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { Bowler, Payment, Team, League, BowlerLeague } from "@shared/schema";
import { format, isValid, parseISO } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { calculateBowlerViewFinancials } from "@/lib/financial-utils";
import { filterActiveBowlerLeagues } from "@/lib/bowler-league-utils";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

function isValidISODate(date: string): date is string {
  try {
    return isValid(parseISO(date));
  } catch {
    return false;
  }
}

export default function BowlerViewPage() {
  const params = useParams();
  const { toast } = useToast();
  const bowlerId = parseInt(params.bowlerId!);
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null);

  interface BowlerDetailsResponse {
    bowler: Bowler;
    bowlerLeagues: BowlerLeague[];
    leagues: League[];
  }

  const { data: detailsResponse, isLoading: loadingDetails } = useQuery<ApiResponse<BowlerDetailsResponse>>({
    queryKey: [`/api/bowlers/${bowlerId}/details`],
    staleTime: 1000 * 60 * 5,
    retry: false,
    enabled: !isNaN(bowlerId),
  });

  const bowler = detailsResponse?.data?.bowler;
  const detailsLeagues = detailsResponse?.data?.leagues || [];

  const bowlerLeagues = useMemo(() => {
    const allLeagues = detailsResponse?.data?.bowlerLeagues || [];
    return filterActiveBowlerLeagues(allLeagues, bowlerId);
  }, [detailsResponse?.data?.bowlerLeagues, bowlerId]);

  // Get all leagues (always fetch so we can show "add to league" option)
  const { data: leaguesResponse } = useQuery<ApiResponse<League[]>>({
    queryKey: ["/api/leagues"],
    staleTime: 1000 * 60 * 30,
    retry: false,
  });
  const leagues = leaguesResponse?.data || [];

  // Get all teams for the add-to-league flow
  const [addLeagueId, setAddLeagueId] = useState<number | null>(null);
  const [addTeamId, setAddTeamId] = useState<number | null>(null);
  const [showAddLeagueDialog, setShowAddLeagueDialog] = useState(false);
  const { data: allTeamsResponse } = useQuery<ApiResponse<Team[]>>({
    queryKey: ["/api/teams"],
    staleTime: 1000 * 60 * 15,
    retry: false,
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

  // Get selected league's active team association
  const selectedAssociation = useMemo(() => {
    return bowlerLeagues.find(bl => 
      bl.leagueId === selectedLeagueId && 
      bl.active && 
      bl.bowlerId === bowlerId
    );
  }, [bowlerLeagues, selectedLeagueId, bowlerId]);

  const { data: teamResponse } = useQuery<ApiResponse<Team>>({
    queryKey: [`/api/teams/${selectedAssociation?.teamId}`],
    enabled: !!selectedAssociation?.teamId,
    staleTime: 1000 * 60 * 15, // Cache for 15 minutes
    retry: false,
  });
  const team = teamResponse?.data;

  const { data: leagueResponse } = useQuery<ApiResponse<League>>({
    queryKey: [`/api/leagues/${selectedLeagueId}`],
    enabled: !!selectedLeagueId,
    staleTime: 1000 * 60 * 30, // Cache for 30 minutes
    retry: false,
  });
  const league = leagueResponse?.data;

  const { data: paymentsResponse } = useQuery<ApiResponse<Payment[]>>({
    queryKey: [`/api/payments?bowlerId=${bowlerId}&leagueId=${selectedLeagueId}`, bowlerId, selectedLeagueId],
    enabled: !!selectedLeagueId && !!bowlerId,
    staleTime: 1000 * 60, // Cache for 1 minute since payments change frequently
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

  // Update initialization logic for selectedLeagueId
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

  // Show initial loading state only when critical data is loading
  if (loadingDetails) {
    return (
      <Layout>
        <PageLoadingState />
      </Layout>
    );
  }

  if (!bowler) {
    return (
      <Layout>
        <div className="text-center">Bowler not found</div>
      </Layout>
    );
  }

  const {
    weeksDue,
    totalSeasonDues,
    totalWeeksInSeason,
    fullSeasonAmount,
    amountPastDue,
    remainingBalance,
    totalPaidAmount,
    totalUnpaidAmount,
  } = calculateBowlerViewFinancials(league, payments);


  return (
    <Layout>
      <ErrorBoundary level="section">
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
                <Badge variant={bowler?.bnContactId ? "default" : "outline"} className={bowler?.bnContactId ? "bg-green-600" : ""}>
                  {bowler?.bnContactId ? "BN Synced" : "BN Not Synced"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
            </div>
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
                  const leagueInfo = leagues?.find(l => l.id === bl.leagueId);
                  return leagueInfo ? (
                    <SelectItem key={bl.leagueId} value={bl.leagueId.toString()}>
                      {leagueInfo.name}
                    </SelectItem>
                  ) : null;
                })}
              </SelectContent>
            </Select>
            {team && (
              <div className="font-medium text-muted-foreground">
                {team.name}
              </div>
            )}
          </div>
        </div>

        <ErrorBoundary level="section">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Weekly Fee</CardTitle>
              <CardDescription>Regular payment amount</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${((league?.weeklyFee || 0) / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Due to Date</CardTitle>
              <CardDescription>
                {weeksDue} week{weeksDue === 1 ? "" : "s"} at ${(
                  (league?.weeklyFee || 0) / 100
                ).toFixed(2)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(totalSeasonDues / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Paid to Date</CardTitle>
              <CardDescription>All payments received</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(totalPaidAmount / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Past Due to Date</CardTitle>
              <CardDescription>Unpaid fees for weeks passed</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-destructive">${(amountPastDue / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Full Season Lineage Amount Due</CardTitle>
              <CardDescription>
                {totalWeeksInSeason} week{totalWeeksInSeason === 1 ? "" : "s"} at ${(
                  (league?.weeklyFee || 0) / 100
                ).toFixed(2)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-orange-600">${(fullSeasonAmount / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Full Season Remaining Balance</CardTitle>
              <CardDescription>Amount left to pay</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-orange-600">${(remainingBalance / 100).toFixed(2)}</p>
            </CardContent>
          </Card>
        </div>
        </ErrorBoundary>
      </div>

      <ErrorBoundary level="section">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Transaction ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center">
                  No payment history
                </TableCell>
              </TableRow>
            ) : (
              payments?.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>
                    {format(new Date(payment.weekOf), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>${(payment.amount / 100).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={payment.status === "paid" ? "default" : "secondary"}
                    >
                      {payment.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {payment.squarePaymentId ? (
                        <>
                          <span className="font-mono text-sm">
                            {payment.squarePaymentId}
                          </span>
                          <a
                            href={`https://squareup.com/dashboard/payments/${payment.squarePaymentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            title="View in Square Dashboard"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      </ErrorBoundary>
      </ErrorBoundary>
    </Layout>
  );
}