import type { TeamScores } from "@shared/types";

export interface LanePair {
  lanes: string;
  homeTeam: TeamScores;
  awayTeam: TeamScores | undefined;
}

export function groupTeamsByLanes(teams: TeamScores[]): LanePair[] {
  // Create a map for O(1) lookup
  const laneMap = new Map<number, TeamScores>();
  teams.forEach(team => laneMap.set(team.laneNumber, team));

  const pairs: LanePair[] = [];
  const laneNumbers = Array.from(laneMap.keys()).sort((a, b) => a - b);

  for (let i = 0; i < laneNumbers.length; i++) {
    const currentLane = laneNumbers[i];
    const currentTeam = laneMap.get(currentLane)!;

    // Check if this lane has already been processed
    const alreadyProcessed = pairs.some(p =>
      p.homeTeam.laneNumber === currentLane ||
      (p.awayTeam && p.awayTeam.laneNumber === currentLane)
    );

    if (alreadyProcessed) continue;

    // Find paired lane (odd lanes pair with even lane above, even lanes pair with odd lane below)
    const pairedLane = currentLane % 2 === 0 ? currentLane - 1 : currentLane + 1;
    const pairedTeam = laneMap.get(pairedLane);

    if (pairedTeam) {
      const [lowerLane, higherLane] = currentLane < pairedLane
        ? [currentLane, pairedLane]
        : [pairedLane, currentLane];

      const [homeTeam, awayTeam] = currentLane < pairedLane
        ? [currentTeam, pairedTeam]
        : [pairedTeam, currentTeam];

      pairs.push({
        lanes: `Lanes ${lowerLane} & ${higherLane}`,
        homeTeam,
        awayTeam
      });
    } else {
      // Handle single lanes (no pair)
      pairs.push({
        lanes: `Lane ${currentLane}`,
        homeTeam: currentTeam,
        awayTeam: undefined
      });
    }
  }

  return pairs.sort((a, b) => a.homeTeam.laneNumber - b.homeTeam.laneNumber);
}
