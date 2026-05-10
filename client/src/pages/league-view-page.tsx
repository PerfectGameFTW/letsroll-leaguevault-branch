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
import { Loader2, Users, CircleDollarSign, Mail, RefreshCw, History, Code, ExternalLink, Copy, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { PageLoadingState, PageErrorState } from "@/components/page-states";

import type { League, Organization } from "@shared/schema";
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
              </CardContent>
            </Card>
          </Link>
        </div>
        </ErrorBoundary>

        <ErrorBoundary level="section">
          <EmbedAdminPanel league={league} />
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

/**
 * Task #681 — admin panel for the embeddable youth registration
 * form. Shows the share URL + iframe snippet, surfaces the gate
 * status (`allowPublicSignup` + `isYouth`) so admins know why an
 * embed might 404, lets admins edit the per-org `allowedEmbedDomains`
 * iframe-ancestors allowlist, and lists the public submissions
 * collected so far. Question authoring is intentionally a JSON
 * editor in v1; a richer drag-and-drop builder is the documented
 * follow-up.
 */
function EmbedAdminPanel({ league }: { league: League }) {
  const { toast } = useToast();
  const [domainsText, setDomainsText] = useState<string | null>(null);
  const [questionsJson, setQuestionsJson] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const orgId = league.organizationId;

  const orgQuery = useQuery<{ success: true; data: Organization }>({
    queryKey: [`/api/organizations/${orgId}`],
    queryFn: async () => {
      const r = await fetch(`/api/organizations/${orgId}`);
      if (!r.ok) throw new Error('Failed to load organization');
      return r.json();
    },
    enabled: !!orgId,
  });

  const questionsQuery = useQuery<{ success: true; data: Array<Record<string, unknown>> }>({
    queryKey: [`/api/leagues/${league.id}/registration-questions`],
    queryFn: async () => {
      const r = await fetch(`/api/leagues/${league.id}/registration-questions`);
      if (!r.ok) throw new Error('Failed to load questions');
      return r.json();
    },
  });

  const registrationsQuery = useQuery<{ success: true; data: Array<{ id: number; bowlerId: number | null; status: string; createdAt: string; answers: unknown }> }>({
    queryKey: [`/api/leagues/${league.id}/registration-questions/registrations`],
    queryFn: async () => {
      const r = await fetch(`/api/leagues/${league.id}/registration-questions/registrations`);
      if (!r.ok) throw new Error('Failed to load registrations');
      return r.json();
    },
  });

  const saveDomains = useMutation({
    mutationFn: async (domains: string[]) => {
      return apiRequest(`/api/organizations/${orgId}`, 'PATCH', { allowedEmbedDomains: domains });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/organizations/${orgId}`] });
      toast({ title: 'Allowed domains saved' });
      setDomainsText(null);
    },
    onError: (e: Error) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  const saveQuestions = useMutation({
    mutationFn: async (questions: unknown[]) => {
      return apiRequest(`/api/leagues/${league.id}/registration-questions`, 'PUT', { questions });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/leagues/${league.id}/registration-questions`] });
      toast({ title: 'Questions saved' });
      setQuestionsJson(null);
    },
    onError: (e: Error) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  const embedUrl = `${window.location.origin}/embed/register/${league.id}`;
  const iframeSnippet = `<iframe src="${embedUrl}" width="100%" height="900" style="border:0" title="Register for ${league.name}"></iframe>`;
  const enabled = league.allowPublicSignup && league.isYouth;
  const org = orgQuery.data?.data;
  const currentDomains = org?.allowedEmbedDomains ?? [];
  const questions = questionsQuery.data?.data ?? [];
  const registrations = registrationsQuery.data?.data ?? [];

  function copy(text: string) {
    void navigator.clipboard?.writeText(text);
    toast({ title: 'Copied to clipboard' });
  }

  return (
    <Card data-testid="embed-admin-panel">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="embed-admin-panel-content"
            data-testid="embed-admin-panel-toggle"
            className="w-full text-left rounded-t-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <Code className="h-5 w-5" />
                <CardTitle className="text-lg flex-1">Embeddable registration form</CardTitle>
                <ChevronDown
                  className={`h-5 w-5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </div>
              <CardDescription>
                Share a public registration page or paste an iframe snippet onto your own site.
                {enabled ? (
                  <Badge variant="default" className="ml-2">Public</Badge>
                ) : (
                  <Badge variant="secondary" className="ml-2">Disabled</Badge>
                )}
              </CardDescription>
            </CardHeader>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent forceMount id="embed-admin-panel-content" className="data-[state=closed]:hidden">
          <CardContent className="space-y-6">
        {!enabled && (
          <div className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/40">
            The public embed currently requires both <strong>Allow public signup</strong> and <strong>Youth league</strong> to be enabled on this league.
            Open the league settings to toggle them.
          </div>
        )}

        <div>
          <label className="text-sm font-medium block mb-1">Direct link</label>
          <div className="flex gap-2">
            <Input readOnly value={embedUrl} data-testid="embed-direct-url" />
            <Button type="button" variant="outline" size="icon" onClick={() => copy(embedUrl)} aria-label="Copy URL">
              <Copy className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" asChild aria-label="Open in new tab">
              <a href={embedUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
            </Button>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">iframe snippet</label>
          <div className="flex gap-2">
            <Textarea readOnly value={iframeSnippet} rows={3} className="font-mono text-xs" data-testid="embed-iframe-snippet" />
            <Button type="button" variant="outline" size="icon" onClick={() => copy(iframeSnippet)} aria-label="Copy snippet">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium">Allowed embed domains</label>
            <span className="text-xs text-muted-foreground">{currentDomains.length} domain(s)</span>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Sites in this allowlist may iframe your registration page. One domain per line (e.g. <code>example.com</code>). Leave empty to block iframing.
          </p>
          <Textarea
            value={domainsText ?? currentDomains.join('\n')}
            onChange={(e) => setDomainsText(e.target.value)}
            rows={4}
            className="font-mono text-xs"
            data-testid="embed-allowed-domains-input"
          />
          <div className="flex justify-end mt-2 gap-2">
            {domainsText !== null && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setDomainsText(null)}>Cancel</Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={domainsText === null || saveDomains.isPending}
              onClick={() => {
                const list = (domainsText ?? '')
                  .split(/\s+/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                saveDomains.mutate(list);
              }}
            >
              {saveDomains.isPending && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              Save domains
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium">Custom questions</label>
            <span className="text-xs text-muted-foreground">{questions.length} question(s)</span>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            JSON array of question objects. Each entry: <code>{`{ "label": string, "type": "short_text|long_text|single_select|multi_select|yes_no|number", "required": boolean, "options": string[] }`}</code>
          </p>
          <Textarea
            value={
              questionsJson ??
              JSON.stringify(
                questions.map((q) => {
                  const obj = q as { label?: unknown; type?: unknown; required?: unknown; options?: unknown };
                  return { label: obj.label, type: obj.type, required: obj.required, options: obj.options ?? [] };
                }),
                null,
                2,
              )
            }
            onChange={(e) => setQuestionsJson(e.target.value)}
            rows={8}
            className="font-mono text-xs"
            data-testid="embed-questions-json"
          />
          <div className="flex justify-end mt-2 gap-2">
            {questionsJson !== null && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setQuestionsJson(null)}>Cancel</Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={questionsJson === null || saveQuestions.isPending}
              onClick={() => {
                try {
                  const parsed = JSON.parse(questionsJson ?? '[]');
                  if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
                  saveQuestions.mutate(parsed);
                } catch (err) {
                  toast({
                    title: 'Invalid JSON',
                    description: err instanceof Error ? err.message : 'Could not parse',
                    variant: 'destructive',
                  });
                }
              }}
            >
              {saveQuestions.isPending && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              Save questions
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium">Submissions</label>
            <span className="text-xs text-muted-foreground">
              {registrations.length} total
              {league.rosterCap != null && ` · cap ${league.rosterCap}`}
            </span>
          </div>
          {registrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No public registrations yet.</p>
          ) : (
            <div className="border rounded-md divide-y max-h-72 overflow-auto" data-testid="embed-registrations-list">
              {registrations.slice(0, 100).map((r) => (
                <div key={r.id} className="p-2 text-xs flex items-center justify-between gap-2">
                  <span className="font-mono">#{r.id}</span>
                  <span className="text-muted-foreground">bowler {r.bowlerId ?? '—'}</span>
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}