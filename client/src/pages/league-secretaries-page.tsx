import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, Trash2 } from "lucide-react";
import { PageLoadingState, PageErrorState } from "@/components/page-states";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { League } from "@shared/schema";

interface SecretaryRow {
  id: number;
  userId: number;
  leagueId: number;
  organizationId: number;
  grantedAt: string;
  user: { id: number; name: string; email: string } | null;
}

export default function LeagueSecretariesPage() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId ?? "0", 10);
  const { toast } = useToast();
  const [emailInput, setEmailInput] = useState("");

  const leagueQuery = useQuery<{ success: true; data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    queryFn: async () => {
      const res = await fetch(`/api/leagues/${leagueId}`);
      if (!res.ok) throw new Error("Failed to load league");
      return res.json();
    },
  });

  const secretariesQuery = useQuery<{ success: true; data: SecretaryRow[] }>({
    queryKey: [`/api/leagues/${leagueId}/secretaries`],
    queryFn: async () => {
      const res = await fetch(`/api/leagues/${leagueId}/secretaries`);
      if (!res.ok) throw new Error("Failed to load secretaries");
      return res.json();
    },
  });

  const grantMutation = useMutation({
    mutationFn: async (email: string) => {
      return await apiRequest<SecretaryRow>(
        `/api/leagues/${leagueId}/secretaries`,
        "POST",
        { email },
      );
    },
    onSuccess: () => {
      setEmailInput("");
      queryClient.invalidateQueries({ queryKey: [`/api/leagues/${leagueId}/secretaries`] });
      toast({ title: "Secretary granted" });
    },
    onError: (err: Error) => {
      toast({ title: "Grant failed", description: err.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (userId: number) => {
      return await apiRequest(`/api/leagues/${leagueId}/secretaries/${userId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/leagues/${leagueId}/secretaries`] });
      toast({ title: "Secretary revoked" });
    },
    onError: (err: Error) => {
      toast({ title: "Revoke failed", description: err.message, variant: "destructive" });
    },
  });

  if (leagueQuery.isLoading) return <Layout><PageLoadingState /></Layout>;
  if (leagueQuery.error) return <Layout><PageErrorState message="Failed to load league" /></Layout>;

  const league = leagueQuery.data?.data;
  const rows = secretariesQuery.data?.data ?? [];

  return (
    <Layout>
      <div className="container mx-auto p-4 sm:p-6 max-w-3xl space-y-4">
        <Button asChild variant="ghost" size="sm" data-testid="link-back-to-league">
          <Link href={`/leagues/${leagueId}`}>
            <ArrowLeft className="size-4 mr-1" /> Back to league
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>League Secretaries</CardTitle>
            <CardDescription>
              {league?.name ?? "League"}: grant per-league admin access to a user. Secretaries
              get league management powers but cannot see saved cards or modify org-level settings.
              System admins cannot grant or revoke this role.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = emailInput.trim();
                if (trimmed.length > 0 && trimmed.includes("@")) {
                  grantMutation.mutate(trimmed);
                }
              }}
            >
              <Input
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="User email to grant"
                type="email"
                inputMode="email"
                data-testid="input-user-email"
              />
              <Button type="submit" disabled={grantMutation.isPending} data-testid="button-grant">
                {grantMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Grant"}
              </Button>
            </form>

            {secretariesQuery.isLoading ? (
              <PageLoadingState />
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No secretaries yet.</p>
            ) : (
              <ul className="divide-y rounded border">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between p-3"
                    data-testid={`secretary-row-${row.userId}`}
                  >
                    <div>
                      <div className="font-medium">{row.user?.name ?? `User #${row.userId}`}</div>
                      <div className="text-xs text-muted-foreground">{row.user?.email ?? ""}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeMutation.mutate(row.userId)}
                      disabled={revokeMutation.isPending}
                      data-testid={`button-revoke-${row.userId}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
