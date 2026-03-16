import { useState, useEffect, useMemo } from "react";  
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout";
import { Loader2, ArrowLeft, ExternalLink, Plus, RefreshCw } from "lucide-react";
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
import { format, differenceInWeeks, startOfToday, isValid, parseISO } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";

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

  // Query for bowler with proper typing and caching
  const { data: bowlerResponse, isLoading: loadingBowler } = useQuery<ApiResponse<Bowler>>({
    queryKey: [`/api/bowlers/${bowlerId}`],
    queryFn: async () => {
      const response = await fetch(`/api/bowlers/${bowlerId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch bowler');
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to fetch bowler');
      }
      return data;
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    retry: false,
    enabled: !isNaN(bowlerId), // Only run if bowlerId is valid
  });
  const bowler = bowlerResponse?.data;

  // Query to get bowler's league associations with proper typing and caching
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<ApiResponse<BowlerLeague[]>>({
    queryKey: ["/api/bowler-leagues", { bowlerId }],
    enabled: !!bowlerId && !isNaN(bowlerId),
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    retry: false,
  });

  // Filter and deduplicate bowler leagues
  const bowlerLeagues = useMemo(() => {
    const allLeagues = bowlerLeaguesResponse?.data || [];
    // First, filter active associations
    const activeLeagues = allLeagues.filter(bl => 
      bl.active && bl.bowlerId === bowlerId
    );
    // Then, ensure unique leagues by taking the most recently ordered association
    return activeLeagues.reduce((unique: BowlerLeague[], current) => {
      const existingIndex = unique.findIndex(bl => bl.leagueId === current.leagueId);
      if (existingIndex === -1) {
        unique.push(current);
      } else if ((current.order ?? 0) > (unique[existingIndex].order ?? 0)) {
        unique[existingIndex] = current;
      }
      return unique;
    }, []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [bowlerLeaguesResponse?.data, bowlerId]);

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
    queryKey: ["/api/payments", bowlerId, selectedLeagueId],
    enabled: !!selectedLeagueId,
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
      queryClient.invalidateQueries({ queryKey: [`/api/bowlers/${bowlerId}`] });
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
  if (loadingBowler || loadingBowlerLeagues) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
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

  // Financial calculations based on selected league
  const totalPaidPayments = payments.filter(p => p.status === 'paid') || [];
  const totalPaidAmount = totalPaidPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalUnpaidPayments = payments.filter(p => p.status !== 'paid') || [];
  const totalUnpaidAmount = totalUnpaidPayments.reduce((sum, p) => sum + p.amount, 0);

  let weeksDue = 0;
  let totalSeasonDues = 0;
  let totalWeeksInSeason = 0;
  let fullSeasonAmount = 0;
  let amountPastDue = 0;

  if (league?.seasonStart && league.seasonEnd && league.weeklyFee) {
    // Validate dates and handle both string and Date types
    const seasonStart = typeof league.seasonStart === 'string' ? parseISO(league.seasonStart) : league.seasonStart;
    const seasonEnd = typeof league.seasonEnd === 'string' ? parseISO(league.seasonEnd) : league.seasonEnd;
    const today = startOfToday();

    if (seasonStart && seasonEnd && isValid(seasonStart) && isValid(seasonEnd) && isValid(today)) {
      if (today < seasonStart) {
        weeksDue = 0;
      } else if (today > seasonEnd) {
        weeksDue = Math.max(0, differenceInWeeks(seasonEnd, seasonStart));
      } else {
        weeksDue = Math.max(0, differenceInWeeks(today, seasonStart));
      }

      totalSeasonDues = league.weeklyFee * weeksDue;
      totalWeeksInSeason = differenceInWeeks(seasonEnd, seasonStart);
      fullSeasonAmount = league.weeklyFee * totalWeeksInSeason;
      amountPastDue = totalSeasonDues - totalPaidAmount;
    } else {
      console.error('Invalid date format in league data:', {
        seasonStart: league.seasonStart,
        seasonEnd: league.seasonEnd
      });
    }
  }

  const remainingBalance = fullSeasonAmount - totalPaidAmount;


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
                <Badge variant={bowler?.bnContactId ? "default" : "outline"} className={bowler?.bnContactId ? "bg-green-600" : ""}>
                  {bowler?.bnContactId ? "BN Synced" : "BN Not Synced"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {bnConfigured && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => bnSyncMutation.mutate()}
                  disabled={bnSyncMutation.isPending}
                >
                  <RefreshCw className={`h-4 w-4 mr-1 ${bnSyncMutation.isPending ? "animate-spin" : ""}`} />
                  {bnSyncMutation.isPending ? "Syncing..." : "Sync to BowlNow"}
                </Button>
              )}
              {availableLeagues.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => setShowAddLeagueDialog(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add to League
                </Button>
              )}
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

        <Dialog open={showAddLeagueDialog} onOpenChange={(open) => {
          setShowAddLeagueDialog(open);
          if (!open) { setAddLeagueId(null); setAddTeamId(null); }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add to League</DialogTitle>
              <DialogDescription>Assign {bowler?.name} to a league and team.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">League</label>
                <Select
                  value={addLeagueId?.toString() || ""}
                  onValueChange={(val) => {
                    setAddLeagueId(parseInt(val));
                    setAddTeamId(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a league" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableLeagues.map((league) => (
                      <SelectItem key={league.id} value={league.id.toString()}>
                        {league.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {addLeagueId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Team</label>
                  <Select
                    value={addTeamId?.toString() || ""}
                    onValueChange={(val) => setAddTeamId(parseInt(val))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a team" />
                    </SelectTrigger>
                    <SelectContent>
                      {teamsForAddLeague.length === 0 ? (
                        <SelectItem value="none" disabled>No teams in this league</SelectItem>
                      ) : (
                        teamsForAddLeague.map((t) => (
                          <SelectItem key={t.id} value={t.id.toString()}>
                            {t.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setShowAddLeagueDialog(false); setAddLeagueId(null); setAddTeamId(null); }}>
                  Cancel
                </Button>
                <Button
                  onClick={() => addToLeagueMutation.mutate()}
                  disabled={!addLeagueId || !addTeamId || addToLeagueMutation.isPending}
                >
                  {addToLeagueMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding...</>
                  ) : (
                    "Add to League"
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Financial Summary Cards */}
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
      </div>

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
    </Layout>
  );
}