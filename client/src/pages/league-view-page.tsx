import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Loader2, Users, DollarSign, Trophy, Save } from "lucide-react";
import type { League } from "@shared/schema";
import { useParams, Link } from "wouter";
import { RulesEditor } from "@/components/rules-editor";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";
import React from 'react';

export default function LeagueViewPage() {
  const params = useParams();
  const { toast } = useToast();
  const leagueId = parseInt(params.leagueId!);
  const [rules, setRules] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);

  const { data: leagueResponse, isLoading } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
  });

  const updateRulesMutation = useMutation({
    mutationFn: async (rules: string) => {
      const response = await apiRequest(
        "PATCH",
        `/api/leagues/${leagueId}`,
        { rules }
      );
      if (!response.ok) {
        throw new Error("Failed to update rules");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/leagues/${leagueId}`] });
      toast({
        title: "Rules updated",
        description: "League rules have been successfully updated.",
      });
      setIsEditing(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating rules",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const league = leagueResponse?.data;

  // Initialize rules from league data when available
  React.useEffect(() => {
    if (league?.rules) {
      setRules(league.rules);
    }
  }, [league?.rules]);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <div className="text-center">League not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{league.name}</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link href={`/leagues/${leagueId}/teams`} className="block">
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Users className="h-5 w-5 mr-2" />
                  Roster Management
                </CardTitle>
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

          <Link href={`/leagues/${leagueId}/scores`} className="block">
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Trophy className="h-5 w-5 mr-2" />
                  Weekly Scores
                </CardTitle>
                <CardDescription>
                  View team matchups and scores
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Track weekly performance, view lane assignments and team matchups
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/leagues/${leagueId}/weekly-payments`} className="block">
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <DollarSign className="h-5 w-5 mr-2" />
                  Weekly Payments
                </CardTitle>
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

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>League Rules</CardTitle>
              <Button
                variant="outline"
                onClick={() => setIsEditing(!isEditing)}
              >
                {isEditing ? "Cancel" : "Edit Rules"}
              </Button>
            </div>
            <CardDescription>
              Manage and view the rules for this league
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <RulesEditor
                content={rules}
                onChange={setRules}
                readOnly={!isEditing}
              />
              {isEditing && (
                <div className="flex justify-end">
                  <Button
                    onClick={() => updateRulesMutation.mutate(rules)}
                    disabled={updateRulesMutation.isPending}
                  >
                    {updateRulesMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    <Save className="mr-2 h-4 w-4" />
                    Save Rules
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}