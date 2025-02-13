import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Score, Game } from "@shared/schema";

interface ScoreGroup {
  game: Game;
  scores: Score[];
}

export default function ScoresPage() {
  const { leagueId, weekNumber } = useParams<{ leagueId: string, weekNumber: string }>();

  const { data: scores, isLoading } = useQuery<ScoreGroup[]>({
    queryKey: ['/api/scores', leagueId, weekNumber],
  });

  if (isLoading) {
    return <div>Loading scores...</div>;
  }

  if (!scores) {
    return <div>No scores found</div>;
  }

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-6">Week {weekNumber} Scores</h1>
      
      <div className="grid gap-6">
        {scores.map((group) => (
          <Card key={group.game.id} className="p-6">
            <h2 className="text-2xl font-semibold mb-4">Game {group.game.gameNumber}</h2>
            
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lane</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Bowler</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Handicap</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.scores.map((score) => (
                    <TableRow key={score.id}>
                      <TableCell>{score.laneNumber}</TableCell>
                      <TableCell>{score.teamId}</TableCell>
                      <TableCell>
                        {score.isVacant ? 'VACANT' : 
                         score.isAbsent ? 'ABSENT' : 
                         score.bowlerId}
                      </TableCell>
                      <TableCell>{score.score}</TableCell>
                      <TableCell>{score.handicap}</TableCell>
                      <TableCell>{score.score + score.handicap}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        ))}
      </div>
    </div>
  );
}
