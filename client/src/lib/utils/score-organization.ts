import type { Game } from "@shared/schema";
import type { WeeklyScores, BowlerScores } from "../types/scores";

export function organizeBowlerScores(scoresData: Game[]): WeeklyScores {
  // Early return for empty data
  if (!scoresData.length) {
    return {
      weekNumber: 0,
      date: "",
      teams: [],
    };
  }

  const teams = new Map<number, Omit<WeeklyScores['teams'][0], 'bowlers'> & { bowlers: Map<number, BowlerScores> }>();

  scoresData.forEach(game => {
    game.teams.forEach(team => {
      if (!teams.has(team.id)) {
        teams.set(team.id, {
          teamId: team.id,
          teamName: team.name,
          teamNumber: team.number,
          laneNumber: team.laneNumber,
          bowlers: new Map(),
        });
      }

      const currentTeam = teams.get(team.id)!;
      team.bowlers.forEach(bowler => {
        if (!currentTeam.bowlers.has(bowler.id)) {
          currentTeam.bowlers.set(bowler.id, {
            bowlerId: bowler.id,
            bowlerName: bowler.name,
            position: bowler.position,
            isVacant: bowler.isVacant,
            isAbsent: bowler.isAbsent,
            isSub: bowler.isSub,
            handicap: bowler.handicap,
            games: [],
          });
        }

        const bowlerData = currentTeam.bowlers.get(bowler.id)!;
        bowlerData.games.push({
          gameNumber: game.gameNumber,
          score: bowler.score,
        });
      });
    });
  });

  return {
    weekNumber: scoresData[0].weekNumber,
    date: scoresData[0].date,
    teams: Array.from(teams.values()).map(team => ({
      ...team,
      bowlers: Array.from(team.bowlers.values())
        .sort((a, b) => a.position - b.position)
        .map(bowler => ({
          ...bowler,
          games: bowler.games.sort((a, b) => a.gameNumber - b.gameNumber),
        })),
    })),
  };
}