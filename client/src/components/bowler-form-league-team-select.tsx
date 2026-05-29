import { FormLabel } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { League, Team } from "@shared/schema";

interface BowlerFormLeagueTeamSelectProps {
  leagues: League[];
  teams: Team[];
  loadingTeams: boolean;
  selectedLeagueId: number | null;
  selectedTeamId: number | null;
  onLeagueChange: (leagueId: number | null) => void;
  onTeamChange: (teamId: number | null) => void;
}

export function BowlerFormLeagueTeamSelect({
  leagues,
  teams,
  loadingTeams,
  selectedLeagueId,
  selectedTeamId,
  onLeagueChange,
  onTeamChange,
}: BowlerFormLeagueTeamSelectProps) {
  return (
    <>
      <div>
        <FormLabel>League</FormLabel>
        <Select
          value={selectedLeagueId?.toString() ?? ""}
          onValueChange={(val) => {
            onLeagueChange(val ? parseInt(val) : null);
            onTeamChange(null);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a league" />
          </SelectTrigger>
          <SelectContent>
            {leagues.flatMap((league) => league.active ? [(
              <SelectItem key={league.id} value={league.id.toString()}>
                {league.name}
              </SelectItem>
            )] : [])}
          </SelectContent>
        </Select>
      </div>

      {selectedLeagueId && (
        <div>
          <FormLabel>Team</FormLabel>
          <Select
            value={selectedTeamId?.toString() ?? ""}
            onValueChange={(val) => onTeamChange(val ? parseInt(val) : null)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a team" />
            </SelectTrigger>
            <SelectContent>
              {loadingTeams ? (
                <SelectItem value="loading" disabled>Loading teams…</SelectItem>
              ) : teams.length === 0 ? (
                <SelectItem value="none" disabled>No teams in this league</SelectItem>
              ) : (
                teams.map((team) => (
                  <SelectItem key={team.id} value={team.id.toString()}>
                    {team.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  );
}
