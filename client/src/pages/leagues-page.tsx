import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Loader2, Plus, Pencil } from "lucide-react";
import type { League } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInWeeks } from "date-fns";
import { Link } from "wouter";

export default function LeaguesPage() {
  const [showForm, setShowForm] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState<League | undefined>();
  const { toast } = useToast();

  const { data: leagues, isLoading } = useQuery<League[]>({
    queryKey: ["/api/leagues"],
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

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Name</TableHead>
              <TableHead>Season</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leagues?.map((league) => {
              const startDate = new Date(league.seasonStart);
              const endDate = new Date(league.seasonEnd);
              const weeks = differenceInWeeks(endDate, startDate);

              return (
                <TableRow key={league.id}>
                  <TableCell>
                    <Link 
                      href={`/leagues/${league.id}/teams`}
                      className="text-foreground hover:underline font-medium"
                    >
                      {league.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {format(startDate, "MMM d, yyyy")} -{" "}
                    {format(endDate, "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>{weeks} weeks</TableCell>
                  <TableCell>
                    <Badge variant={league.active ? "default" : "secondary"}>
                      {league.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedLeague(league);
                          setShowForm(true);
                        }}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <LeagueForm 
        open={showForm} 
        onClose={() => {
          setShowForm(false);
          setSelectedLeague(undefined);
        }}
        league={selectedLeague}
      />
    </Layout>
  );
}