import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Calendar as CalendarIcon } from "lucide-react";
import { format, addWeeks, startOfWeek, isSameDay } from "date-fns";
import type { League, Team } from "@shared/schema";
import { useParams, Link } from "wouter";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export default function WeeklyPaymentsPage() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTeam, setSelectedTeam] = useState<string>();

  // Fetch league details
  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
  });

  // Fetch teams for this league
  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: Team[] }>({
    queryKey: ["/api/teams", leagueId],
    queryFn: async () => {
      const response = await fetch(`/api/teams?leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch teams');
      }
      return response.json();
    }
  });

  const league = leagueResponse?.data;
  const teams = teamsResponse?.data || [];

  // Calculate the disabled dates (outside season range)
  let disabledDates: { before: Date; after: Date } | undefined;
  if (league) {
    const startDate = new Date(league.seasonStart);
    const endDate = new Date(league.seasonEnd);
    disabledDates = {
      before: startDate,
      after: endDate,
    };
  }

  if (loadingLeague || loadingTeams) {
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
        <Link
          href={`/leagues/${leagueId}`}
          className="text-muted-foreground hover:text-foreground flex items-center mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to League Dashboard
        </Link>

        <h1 className="text-2xl font-bold">Weekly Payments - {league.name}</h1>

        <Card>
          <CardHeader>
            <CardTitle>Select Week and Team</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Week</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !selectedDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedDate ? (
                      format(selectedDate, "MMM d, yyyy")
                    ) : (
                      <span>Select a week</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    disabled={disabledDates}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Team</label>
              <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id.toString()} value={team.id.toString()}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button 
              disabled={!selectedDate || !selectedTeam}
              onClick={() => {
                // This will be implemented in the next step
                console.log("View/Log payments for:", {
                  week: selectedDate?.toISOString(),
                  teamId: selectedTeam
                });
              }}
            >
              View/Log Payments
            </Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}