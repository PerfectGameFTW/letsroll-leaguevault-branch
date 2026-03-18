import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { LeagueForm } from "@/components/league-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Pencil, Archive, RotateCcw, Trash, AlertTriangle } from "lucide-react";
import type { League, Team, Location } from "@shared/schema";
import { WEEKDAYS } from "@shared/schema";
import type { ScoreWithRelations } from "@/lib/types/scores";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInWeeks } from "date-fns";
import { getSeasonLabel } from "@/lib/season-utils";
import { Link } from "wouter";

export default function LeaguesPage() {
  const [showForm, setShowForm] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState<League | undefined>();
  const [showArchived, setShowArchived] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [archiveConfirmId, setArchiveConfirmId] = useState<number | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: leaguesResponse, isLoading: loadingLeagues } = useQuery<{ data: League[] }>({
    queryKey: ["/api/leagues"],
  });

  const { data: locationsResponse } = useQuery<{ data: Location[] }>({
    queryKey: ["/api/locations"],
  });

  const allLocations = locationsResponse?.data || [];

  const leagues = leaguesResponse?.data;

  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: Team[] }>({
    queryKey: ["/api/teams"],
  });

  const allTeams = teamsResponse?.data || [];

  // Get weekly scores for the first league (if any)
  const firstLeague = leagues?.[0];
  const currentWeek = firstLeague ? Math.ceil(differenceInWeeks(new Date(), new Date(firstLeague.seasonStart))) : 0;

  const { data: scoresResponse, isLoading: loadingScores } = useQuery<{ data: ScoreWithRelations[] }>({
    queryKey: ["/api/scores/history", firstLeague?.id],
    queryFn: async () => {
      if (!firstLeague?.id) throw new Error("No league selected");
      const response = await fetch(`/api/scores?leagueId=${firstLeague.id}&weekNumber=${currentWeek}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to fetch scores');
      }
      return response.json();
    },
    enabled: !!firstLeague && currentWeek > 0,
  });

  const weeklyScores = scoresResponse?.data || [];

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/leagues/${id}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leagues'] });
      toast({ title: 'League Deleted', description: 'The league and all its data have been permanently deleted.' });
      setDeleteConfirmId(null);
      setDeleteConfirmName('');
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: `Failed to delete league: ${error.message}`, variant: 'destructive' });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/leagues/${id}/archive`, 'PATCH');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leagues'] });
      toast({ title: 'League Archived', description: 'The league has been archived and hidden from normal views.' });
      setArchiveConfirmId(null);
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: `Failed to archive league: ${error.message}`, variant: 'destructive' });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/leagues/${id}/restore`, 'PATCH');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/leagues'] });
      toast({ title: 'League Restored', description: 'The league has been restored and is now active again.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: `Failed to restore league: ${error.message}`, variant: 'destructive' });
    },
  });

  // Create a map of league ID to team count
  const teamCounts = allTeams.reduce((acc, team) => {
    acc[team.leagueId] = (acc[team.leagueId] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  if (loadingLeagues || loadingTeams || loadingScores) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  const allLeagues = leagues || [];
  const locationMap = allLocations.reduce((acc, loc) => { acc[loc.id] = loc.name; return acc; }, {} as Record<number, string>);
  let filteredLeagues = showArchived ? allLeagues : allLeagues.filter(l => l.active);
  if (locationFilter !== 'all') {
    if (locationFilter === 'none') {
      filteredLeagues = filteredLeagues.filter(l => !l.locationId);
    } else {
      filteredLeagues = filteredLeagues.filter(l => l.locationId === parseInt(locationFilter));
    }
  }
  filteredLeagues = filteredLeagues.slice().sort((a, b) => {
    const aIdx = WEEKDAYS.indexOf(a.weekDay as typeof WEEKDAYS[number]);
    const bIdx = WEEKDAYS.indexOf(b.weekDay as typeof WEEKDAYS[number]);
    return aIdx - bIdx;
  });
  const archivedCount = allLeagues.filter(l => !l.active).length;

  return (
    <Layout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Leagues</h1>
        <Button onClick={() => {
          setSelectedLeague(undefined);
          setShowForm(true);
        }}>
          <Plus className="h-4 w-4 mr-2" />
          Add League
        </Button>
      </div>

      <div className="rounded-md border mb-8">
        <div className="flex items-center justify-between gap-4 p-3 border-b">
          {allLocations.length > 0 && (
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">Location:</Label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="w-[180px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  <SelectItem value="none">No Location</SelectItem>
                  {allLocations.filter(l => l.active).map(loc => (
                    <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {archivedCount > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <Label htmlFor="show-archived-leagues" className="text-sm text-muted-foreground cursor-pointer">
                Show archived ({archivedCount})
              </Label>
              <Switch
                id="show-archived-leagues"
                checked={showArchived}
                onCheckedChange={setShowArchived}
              />
            </div>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[12%]">Weekday</TableHead>
              <TableHead className="w-[20%]">Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Teams</TableHead>
              <TableHead className="w-[15%]">Start Date</TableHead>
              <TableHead className="w-[15%]">End Date</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLeagues.map((league) => {
              const startDate = new Date(league.seasonStart);
              const endDate = new Date(league.seasonEnd);
              const weeks = differenceInWeeks(endDate, startDate);
              const bowlingDay = league.weekDay ? league.weekDay.charAt(0).toUpperCase() + league.weekDay.slice(1) : 'Not set';

              return (
                <TableRow key={league.id} className={!league.active ? 'opacity-60' : ''}>
                  <TableCell>{bowlingDay}</TableCell>
                  <TableCell>
                    <Link 
                      href={`/leagues/${league.id}`}
                      className="text-foreground hover:underline font-medium"
                    >
                      {league.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {getSeasonLabel(league.seasonStart, league.seasonEnd)}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {league.locationId ? locationMap[league.locationId] || '—' : '—'}
                  </TableCell>
                  <TableCell>{teamCounts[league.id] || 0}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {format(startDate, "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {format(endDate, "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>{weeks} weeks</TableCell>
                  <TableCell>
                    <Badge variant={league.active ? "default" : "secondary"}>
                      {league.active ? "Active" : "Archived"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedLeague(league);
                          setShowForm(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {league.active ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setArchiveConfirmId(league.id)}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => restoreMutation.mutate(league.id)}
                          disabled={restoreMutation.isPending}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteConfirmId(league.id)}
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {weeklyScores.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Recent Scores</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bowler</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Average</TableHead>
                  <TableHead>Handicap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeklyScores.map((score) => (
                  <TableRow key={score.id}>
                    <TableCell>{score.bowler.name}</TableCell>
                    <TableCell>{score.team.name}</TableCell>
                    <TableCell>{score.score}</TableCell>
                    <TableCell>{score.average || 'N/A'}</TableCell>
                    <TableCell>{score.handicap}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <LeagueForm 
        open={showForm} 
        onClose={() => {
          setShowForm(false);
          setSelectedLeague(undefined);
        }}
        league={selectedLeague}
      />

      {/* Archive Confirmation Dialog */}
      <AlertDialog open={!!archiveConfirmId} onOpenChange={(open) => { if (!open) setArchiveConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive League</AlertDialogTitle>
            <AlertDialogDescription>
              This will hide the league from normal views. The league and all its data (teams, bowlers, scores, payments) will be preserved and can be restored at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveConfirmId && archiveMutation.mutate(archiveConfirmId)}
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending ? 'Archiving...' : 'Archive League'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Permanent Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) { setDeleteConfirmId(null); setDeleteConfirmName(''); } }}>
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Permanently Delete League
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="font-semibold text-destructive">
                  This action is irreversible and cannot be undone.
                </p>
                <p>
                  Permanently deleting this league will also delete:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>All teams within this league</li>
                  <li>All bowler-league memberships</li>
                  <li>All payment records for this league</li>
                  <li>All game and score history</li>
                  <li>All payment schedules</li>
                </ul>
                <p className="text-sm">
                  Consider archiving instead if you may need this data in the future.
                </p>
                <div className="pt-2">
                  <Label htmlFor="confirm-league-name" className="text-sm font-medium">
                    Type the league name to confirm: <span className="font-bold">{allLeagues.find(l => l.id === deleteConfirmId)?.name}</span>
                  </Label>
                  <Input
                    id="confirm-league-name"
                    className="mt-1.5"
                    placeholder="Type league name here"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmName('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={
                deleteMutation.isPending ||
                deleteConfirmName !== allLeagues.find(l => l.id === deleteConfirmId)?.name
              }
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Permanently Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}