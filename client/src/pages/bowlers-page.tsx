import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { BowlerForm } from "@/components/bowler-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Eye, EyeOff, Search, Pencil } from "lucide-react";
import type { Bowler, Team, League } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";

export default function BowlersPage() {
  const [showForm, setShowForm] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBowler, setSelectedBowler] = useState<Bowler | undefined>();
  const { toast } = useToast();

  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
  });
  const bowlers = bowlersResponse?.data;

  const { data: bowlerLeagues } = useQuery({
    queryKey: ["/api/bowler-leagues"],
  });

  const { data: teams } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const { data: leagues } = useQuery<League[]>({
    queryKey: ["/api/leagues"],
  });

  // Helper function to get team for a bowler
  const getBowlerTeam = (bowler: Bowler) => {
    const bowlerLeague = bowlerLeagues?.data?.find(bl => bl.bowlerId === bowler.id);
    return teams?.find(t => t.id === bowlerLeague?.teamId);
  };

  const filteredBowlers = bowlers?.filter(bowler => {
    const matchesSearch = searchQuery === "" || 
      bowler.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bowler.email.toLowerCase().includes(searchQuery.toLowerCase());
    return (showInactive ? true : bowler.active) && matchesSearch;
  });

  if (loadingBowlers) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  // Helper function to get league weekly fee
  const getWeeklyFee = (bowler: Bowler) => {
    if (!bowler.teamId) return 0;
    const team = teams?.find(t => t.id === bowler.teamId);
    if (!team) return 0;
    const league = leagues?.find(l => l.id === team.leagueId);
    return league?.weeklyFee || 0;
  };

  return (
    <Layout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Bowlers</h1>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Bowler
        </Button>
      </div>

      <div className="space-y-4 mb-6">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search bowlers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center space-x-2">
          {showInactive ? (
            <Eye className="h-4 w-4 text-muted-foreground" />
          ) : (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm text-muted-foreground">Show inactive bowlers</span>
          <Switch
            checked={showInactive}
            onCheckedChange={setShowInactive}
          />
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Weekly Fee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBowlers?.map((bowler) => (
              <TableRow key={bowler.id}>
                <TableCell>
                  <Link 
                    href={`/bowlers/${bowler.id}`}
                    className="hover:underline text-foreground"
                  >
                    {bowler.name}
                  </Link>
                </TableCell>
                <TableCell>{bowler.email}</TableCell>
                <TableCell>${(getWeeklyFee(bowler) / 100).toFixed(2)}</TableCell>
                <TableCell>
                  <Badge variant={bowler.active ? "default" : "secondary"}>
                    {bowler.active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedBowler(bowler);
                      setShowForm(true);
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <BowlerForm 
        open={showForm} 
        onClose={() => {
          setShowForm(false);
          setSelectedBowler(undefined);
        }}
        bowler={selectedBowler}
      />
    </Layout>
  );
}