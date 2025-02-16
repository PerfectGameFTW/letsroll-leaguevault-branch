import type { Game, Score } from "@shared/schema";
import type { WeeklyScores, BowlerScores, TeamScores } from "../types/scores";

interface TeamScoreMap {
  teamId: number;
  teamName: string;
  teamNumber: number;
  laneNumber: number;
  bowlers: Map<number, BowlerScores>;
}

export function organizeBowlerScores(scoresData: Score[]): WeeklyScores {
  // Early return for empty data
  if (!scoresData.length) {
    return {
      weekNumber: 0,
      date: "",
      teams: [],
    };
  }

  // Pre-allocate the teams map with proper typing
  const teams = new Map<number, TeamScoreMap>();

  // Process all scores in a single pass
  for (const score of scoresData) {
    // Get or create team entry
    let teamEntry = teams.get(score.team.id);
    if (!teamEntry) {
      teamEntry = {
        teamId: score.team.id,
        teamName: score.team.name,
        teamNumber: score.team.number,
        laneNumber: score.laneNumber,
        bowlers: new Map(),
      };
      teams.set(score.team.id, teamEntry);
    }

    // Process bowler scores
    let bowlerEntry = teamEntry.bowlers.get(score.bowlerId);
    if (!bowlerEntry) {
      bowlerEntry = {
        bowlerId: score.bowlerId,
        bowlerName: score.bowler.name,
        position: score.position,
        isVacant: score.isVacant,
        isAbsent: score.isAbsent,
        isSub: score.isSub,
        handicap: score.handicap,
        games: [],
      };
      teamEntry.bowlers.set(score.bowlerId, bowlerEntry);
    }

    // Add game score
    bowlerEntry.games.push({
      gameNumber: score.game.gameNumber,
      score: score.score,
    });
  }

  // Convert maps to arrays and sort data
  return {
    weekNumber: scoresData[0].game.weekNumber,
    date: scoresData[0].game.date,
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

// Helper function to calculate series total
export function calculateSeriesTotal(games: Array<{ score: number | null }>): number {
  return games
    .map(g => g.score)
    .filter((score): score is number => score !== null)
    .reduce((sum, score) => sum + score, 0);
}