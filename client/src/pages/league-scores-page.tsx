import { useState } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, AlertCircle } from "lucide-react";
import { useLeagueScores } from "@/hooks/use-league-scores";
import { groupTeamsByLanes } from "@/lib/utils/lane-pairing";
import { cn } from "@/lib/utils";

export default function LeagueScoresPage() {
  const params = useParams();
  const leagueId = params.leagueId ? parseInt(params.leagueId) : undefined;
  const [selectedWeek, setSelectedWeek] = useState<number>(20); // Default to week 20

  if (!leagueId || isNaN(leagueId)) {
    return (
      <Layout>
        <div className="flex items-center gap-2 p-4 rounded-md bg-destructive/10 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Invalid league ID provided</p>
        </div>
      </Layout>
    );
  }

  const { league, scores, isLoading, error } = useLeagueScores({
    leagueId,
    weekNumber: selectedWeek
  });

  const lanePairs = scores?.length > 0 ? groupTeamsByLanes(scores) : [];

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
        <div className="space-y-4">
          <Link
            href={`/leagues/${leagueId}`}
            className="text-muted-foreground hover:text-foreground flex items-center mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to League
          </Link>
          <div className="p-4 rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <p>Error loading scores: {error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <Link
          href={`/leagues/${leagueId}`}
          className="text-muted-foreground hover:text-foreground flex items-center"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to League
        </Link>

        <div>
          <h1 className="text-2xl font-bold mb-2">{league?.name} Scores</h1>
          <p className="text-muted-foreground mb-6">
            Week {selectedWeek} Scores
          </p>
        </div>

        {lanePairs?.length > 0 ? (
          <div className="grid gap-6">
            {lanePairs.map((pair, pairIndex) => (
              <Card key={pairIndex}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-semibold text-primary">
                    {pair.lanes}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-8">
                    {[pair.homeTeam, pair.awayTeam].map((team, teamIndex) => (
                      team && (
                        <div key={teamIndex} className="space-y-2">
                          <h4 className="font-medium">{team.teamName}</h4>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[200px]">Bowler</TableHead>
                                <TableHead className="text-right">Handicap</TableHead>
                                <TableHead className="text-right">Game 1</TableHead>
                                <TableHead className="text-right">Game 2</TableHead>
                                <TableHead className="text-right">Game 3</TableHead>
                                <TableHead className="text-right">Series</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {team.bowlers.map((bowler) => (
                                <TableRow key={bowler.bowlerId}>
                                  <TableCell>
                                    {bowler.bowlerName}
                                    {bowler.isSub && (
                                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                        Sub
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">{bowler.handicap}</TableCell>
                                  {bowler.games.map((game, idx) => (
                                    <TableCell 
                                      key={idx}
                                      className={cn(
                                        "text-right",
                                        (game?.score || 0) >= 200 && "text-primary",
                                        (game?.score || 0) >= 250 && "text-green-600"
                                      )}
                                    >
                                      {game?.score ?? "—"}
                                    </TableCell>
                                  ))}
                                  <TableCell className="text-right font-medium">
                                    {bowler.games.reduce((sum, game) => sum + (game?.score || 0), 0)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center p-8 border rounded-lg bg-background">
            <p className="text-lg text-muted-foreground">No scores found for Week {selectedWeek}</p>
          </div>
        )}
      </div>
    </Layout>
  );
}