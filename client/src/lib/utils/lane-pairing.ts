import type { TeamScores } from "../types/scores";

export interface LanePair {
  lanes: string;
  homeTeam: TeamScores;
  awayTeam: TeamScores | undefined;
}

export function groupTeamsByLanes(teams: TeamScores[]): LanePair[] {
  console.log('[groupTeamsByLanes] Starting team grouping:', {
    totalTeams: teams.length,
    laneNumbers: teams.map(t => t.laneNumber)
  });

  // Create a map for O(1) lookup
  const laneMap = new Map<number, TeamScores>();
  teams.forEach(team => laneMap.set(team.laneNumber, team));

  const pairs: LanePair[] = [];
  const laneNumbers = Array.from(laneMap.keys()).sort((a, b) => a - b);

  console.log('[groupTeamsByLanes] Processing lanes:', {
    uniqueLanes: laneNumbers.length,
    lanes: laneNumbers
  });

  for (let i = 0; i < laneNumbers.length; i++) {
    const currentLane = laneNumbers[i];
    const currentTeam = laneMap.get(currentLane)!;

    // Check if this lane has already been processed
    const alreadyProcessed = pairs.some(p =>
      p.homeTeam.laneNumber === currentLane ||
      (p.awayTeam && p.awayTeam.laneNumber === currentLane)
    );

    if (alreadyProcessed) {
      console.log(`[groupTeamsByLanes] Lane ${currentLane} already processed, skipping`);
      continue;
    }

    // Find paired lane (odd lanes pair with even lane above, even lanes pair with odd lane below)
    const pairedLane = currentLane % 2 === 0 ? currentLane - 1 : currentLane + 1;
    const pairedTeam = laneMap.get(pairedLane);

    console.log('[groupTeamsByLanes] Processing lane pair:', {
      currentLane,
      pairedLane,
      hasPairedTeam: !!pairedTeam
    });

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

  const sortedPairs = pairs.sort((a, b) => a.homeTeam.laneNumber - b.homeTeam.laneNumber);

  console.log('[groupTeamsByLanes] Finished grouping:', {
    totalPairs: sortedPairs.length,
    pairSummary: sortedPairs.map(p => ({
      lanes: p.lanes,
      homeTeam: p.homeTeam.teamName,
      awayTeam: p.awayTeam?.teamName
    }))
  });

  return sortedPairs;
}