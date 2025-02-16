import type { Game, Score, Team, Bowler } from "@shared/schema";

export interface ScoreWithRelations extends Score {
  bowler: {
    id: number;
    name: string;
  };
  team: {
    id: number;
    name: string;
    number: number;
  };
  game: {
    id: number;
    weekNumber: number;
    gameNumber: number;
    date: string;
  };
}

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