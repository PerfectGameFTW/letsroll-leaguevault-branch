import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Users, CircleDollarSign, Mail, RefreshCw, History } from "lucide-react";
import { PageLoadingState, PageErrorState } from "@/components/page-states";

import type { League } from "@shared/schema";
import { useParams, Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getSeasonLabel } from "@/lib/season-utils";

export default function LeagueViewPage() {
  const params = useParams();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const leagueId = parseInt(params.leagueId!);
  const [inviteResult, setInviteResult] = useState<{ sent: number; alreadyRegistered: number; noEmail: number } | null>(null);
  const [showNewSeason, setShowNewSeason] = useState(false);
  const [newSeasonStart, setNewSeasonStart] = useState("");
  const [newSeasonEnd, setNewSeasonEnd] = useState("");

  const { data: leagueResponse, isLoading, error, refetch } = useQuery<{ success: true; data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    queryFn: async () => {
      const response = await fetch(`/api/leagues/${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch league');
      }
      return response.json();
    },
    retry: false
  });

  const league = leagueResponse?.data;

  const { data: seasonHistoryResponse } = useQuery<{ success: true; data: League[] }>({
    queryKey: ['/api/leagues', leagueId, 'season-history'],
    queryFn: async () => {
      const response = await fetch(`/api/leagues/${leagueId}/season-history`);
      if (!response.ok) throw new Error('Failed to fetch season history');
      return response.json();
    },
    enabled: !!league,
  });
  const seasonHistory = seasonHistoryResponse?.data || [];

  const newSeasonMutation = useMutation({
    mutationFn: async ({ seasonStart, seasonEnd }: { seasonStart: string; seasonEnd: string }) => {
      return await apiRequest<League>(`/api/leagues/${leagueId}/new-season`, "POST", { seasonStart, seasonEnd });
    },
    onSuccess: (data) => {
      const newLeague = data.data;
      queryClient.invalidateQueries({ queryKey: ["/api/leagues"] });
      toast({
        title: "New Season Created",
        description: `${league?.name} new season has been created. The previous season has been archived.`,
      });
      setShowNewSeason(false);
      setNewSeasonStart("");
      setNewSeasonEnd("");
      setLocation(`/leagues/${newLeague.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create new season",
        variant: "destructive",
      });
    },
  });

  const sendInvitesMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest<{ sent: number; alreadyRegistered: number; noEmail: number }>(
        `/api/leagues/${leagueId}/send-invites`,
        "POST"
      );
    },
    onSuccess: (data) => {
      const result = data.data;
      setInviteResult(result);
      toast({
        title: "Invites Sent",
        description: `Sent ${result.sent} invite(s). ${result.alreadyRegistered} already registered. ${result.noEmail} have no email.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send invites",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Layout>
        <PageLoadingState />
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <PageErrorState message={`Error loading league: ${error instanceof Error ? error.message : 'Unknown error occurred'}`} onRetry={() => refetch()} />
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-destructive">League not found</h2>
          <p className="text-muted-foreground">The requested league could not be found</p>
          <Link href="/leagues" className="text-primary hover:underline mt-4 inline-block">
            Return to Leagues
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <ErrorBoundary level="section">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{league.name}</h1>
            {league.seasonStart && league.seasonEnd && (
              <p className="text-sm text-muted-foreground mt-1">
                {getSeasonLabel(league.seasonStart, league.seasonEnd)}
                {!league.active && <Badge variant="secondary" className="ml-2">Archived</Badge>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={sendInvitesMutation.isPending}>
                {sendInvitesMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4 mr-2" />
                )}
                Send Registration Invites
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Send Registration Invites</AlertDialogTitle>
                <AlertDialogDescription>
                  This will send registration emails to all bowlers in this league who have an email address but don't have an account yet. Bowlers who already have accounts will be skipped.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => sendInvitesMutation.mutate()}>
                  Send Invites
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          </div>
        </div>

        {inviteResult && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <Mail className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Invite Results</h3>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-primary">{inviteResult.sent}</p>
                  <p className="text-sm text-muted-foreground">Invites Sent</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{inviteResult.alreadyRegistered}</p>
                  <p className="text-sm text-muted-foreground">Already Registered</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{inviteResult.noEmail}</p>
                  <p className="text-sm text-muted-foreground">No Email on File</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <ErrorBoundary level="section">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link href={`/leagues/${leagueId}/teams`} className="block">
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <div className="flex justify-center mb-2">
                  <Users className="h-6 w-6" />
                </div>
                <CardTitle>Roster Management</CardTitle>
                <CardDescription>
                  Manage bowlers and teams in your league
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Add or remove bowlers, organize team rosters, and manage team assignments
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/leagues/${leagueId}/weekly-payments`} className="block">
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <div className="flex justify-center mb-2">
                  <CircleDollarSign className="h-6 w-6" />
                </div>
                <CardTitle>Weekly Payments</CardTitle>
                <CardDescription>
                  Log and track weekly cash/check payments
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Record manual payments by team and week, view payment history
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>
        </ErrorBoundary>

        <ErrorBoundary level="section">
        {league.active && (
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setShowNewSeason(true)}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Start New Season
            </Button>
          </div>
        )}

        {seasonHistory.length > 1 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <History className="h-5 w-5" />
                <CardTitle className="text-lg">Season History</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {seasonHistory.map((season) => (
                  <Link key={season.id} href={`/leagues/${season.id}`}>
                    <Badge
                      variant={season.id === leagueId ? "default" : "outline"}
                      className="cursor-pointer hover:bg-accent transition-colors"
                    >
                      {getSeasonLabel(season.seasonStart, season.seasonEnd)}
                      {!season.active && season.id !== leagueId && " (Archived)"}
                    </Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={showNewSeason} onOpenChange={(open) => { if (!open) { setShowNewSeason(false); setNewSeasonStart(""); setNewSeasonEnd(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start New Season</DialogTitle>
              <DialogDescription>
                Create a new season of <strong>{league.name}</strong> with the same teams and bowlers. The current season will be archived and remain accessible in the season history.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <label className="text-sm font-medium">New Season Start Date</label>
                <Input
                  type="date"
                  value={newSeasonStart}
                  onChange={(e) => setNewSeasonStart(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">New Season End Date</label>
                <Input
                  type="date"
                  value={newSeasonEnd}
                  onChange={(e) => setNewSeasonEnd(e.target.value)}
                  className="mt-1"
                />
              </div>
              {newSeasonStart && newSeasonEnd && new Date(newSeasonEnd) > new Date(newSeasonStart) && (
                <p className="text-sm text-muted-foreground">
                  This will create the <strong>{getSeasonLabel(newSeasonStart, newSeasonEnd)}</strong>
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowNewSeason(false); setNewSeasonStart(""); setNewSeasonEnd(""); }}>
                Cancel
              </Button>
              <Button
                onClick={() => newSeasonMutation.mutate({ seasonStart: newSeasonStart, seasonEnd: newSeasonEnd })}
                disabled={!newSeasonStart || !newSeasonEnd || newSeasonMutation.isPending}
              >
                {newSeasonMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Create New Season
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </ErrorBoundary>
      </div>
      </ErrorBoundary>
    </Layout>
  );
}