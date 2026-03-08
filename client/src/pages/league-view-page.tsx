import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Loader2, Users, CircleDollarSign, Mail } from "lucide-react";

import type { League } from "@shared/schema";
import { useParams, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function LeagueViewPage() {
  const params = useParams();
  const { toast } = useToast();
  const leagueId = parseInt(params.leagueId!);
  const [inviteResult, setInviteResult] = useState<{ sent: number; alreadyRegistered: number; noEmail: number } | null>(null);

  const { data: leagueResponse, isLoading, error } = useQuery<{ success: true; data: League }>({
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
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-destructive">Error loading league</h2>
          <p className="text-muted-foreground">{error instanceof Error ? error.message : 'Unknown error occurred'}</p>
        </div>
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
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{league.name}</h1>
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
      </div>
    </Layout>
  );
}