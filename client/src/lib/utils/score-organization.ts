import type { ScoreWithRelations } from "../types/scores";
import type { WeeklyScores, BowlerScores, TeamScores } from "../types/scores";

interface TeamScoreMap {
  teamId: number;
  teamName: string;
  teamNumber: number;
  laneNumber: number;
  bowlers: Map<number, BowlerScores>;
}

export function organizeBowlerScores(scoresData: ScoreWithRelations[]): WeeklyScores {
  console.log('[organizeBowlerScores] Processing scores:', {
    totalScores: scoresData.length,
    firstScore: scoresData[0] ? {
      bowler: scoresData[0].bowler.name,
      team: scoresData[0].team.name,
      game: scoresData[0].game.weekNumber
    } : null
  });

  // Early return for empty data
  if (!scoresData.length) {
    console.log('[organizeBowlerScores] No scores to process');
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
    let bowlerEntry = teamEntry.bowlers.get(score.bowler.id);
    if (!bowlerEntry) {
      bowlerEntry = {
        bowlerId: score.bowler.id,
        bowlerName: score.bowler.name,
        position: score.position,
        isVacant: score.isVacant,
        isAbsent: score.isAbsent,
        isSub: score.isSub,
        handicap: score.handicap,
        games: [],
      };
      teamEntry.bowlers.set(score.bowler.id, bowlerEntry);
    }

    // Add game score
    bowlerEntry.games.push({
      gameNumber: score.game.gameNumber,
      score: score.score,
    });
  }

  const result = {
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

  console.log('[organizeBowlerScores] Processed data:', {
    weekNumber: result.weekNumber,
    date: result.date,
    teamCount: result.teams.length,
    teamsProcessed: result.teams.map(t => ({
      name: t.teamName,
      bowlerCount: t.bowlers.length
    }))
  });

  return result;
}

// Helper function to calculate series total
export function calculateSeriesTotal(games: Array<{ score: number | null }>): number {
  const total = games
    .map(g => g.score)
    .filter((score): score is number => score !== null)
    .reduce((sum, score) => sum + score, 0);

  console.log('[calculateSeriesTotal] Calculated total:', {
    gamesCount: games.length,
    total
  });

  return total;
}