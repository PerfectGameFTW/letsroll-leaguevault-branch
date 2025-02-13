import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

interface GameScore {
  score: number | null;
  handicap: number | null;
  total: number | null;
  isVacant: boolean;
  isAbsent: boolean;
  isSub: boolean;
}

interface BowlerScores {
  bowlerId: number;
  bowlerName: string;
  teamId: number;
  teamName: string;
  date: string;
  weekNumber: number;
  games: GameScore[];
  seriesTotal: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

export default function ScoresPage() {
  const { leagueId, weekNumber } = useParams<{ leagueId: string; weekNumber: string }>();

  const { data: scoresResponse, isLoading } = useQuery<ApiResponse<BowlerScores[]>>({
    queryKey: ['/api/scores', leagueId, weekNumber],
    queryFn: async () => {
      const response = await fetch(`/api/scores?leagueId=${leagueId}&weekNumber=${weekNumber}`);
      if (!response.ok) {
        throw new Error('Failed to fetch scores');
      }
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!scoresResponse?.data) {
    return <div>No scores found</div>;
  }

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-6">Weekly Scores</h1>

      <Card className="p-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Week</TableHead>
              <TableHead>Bowler</TableHead>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">Game 1</TableHead>
              <TableHead className="text-right">Game 2</TableHead>
              <TableHead className="text-right">Game 3</TableHead>
              <TableHead className="text-right">Series</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scoresResponse.data.map((bowler) => (
              <TableRow key={`${bowler.bowlerId}-${bowler.teamId}`}>
                <TableCell>{format(new Date(bowler.date), "MMM d, yyyy")}</TableCell>
                <TableCell>{bowler.weekNumber}</TableCell>
                <TableCell>
                  {bowler.bowlerName}
                  {bowler.games.some(g => g.isSub) && " (Sub)"}
                </TableCell>
                <TableCell>{bowler.teamName}</TableCell>
                {bowler.games.map((game, index) => (
                  <TableCell key={index} className="text-right">
                    {game.isVacant ? "VACANT" :
                     game.isAbsent ? "ABSENT" :
                     game.score === null ? "—" :
                     game.score}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium">
                  {bowler.seriesTotal || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}