import type { Game, Score, Team, Bowler } from "@shared/schema";

export interface BowlerScores {
  bowlerId: number;
  bowlerName: string;
  position: number;
  isVacant: boolean;
  isAbsent: boolean;
  isSub: boolean;
  handicap: number | null;
  games: Array<{
    gameNumber: number;
    score: number | null;
  }>;
}

export interface TeamScores {
  teamId: number;
  teamName: string;
  teamNumber: number;
  laneNumber: number;
  bowlers: BowlerScores[];
}

export interface WeeklyScores {
  weekNumber: number;
  date: string;
  teams: TeamScores[];
}
