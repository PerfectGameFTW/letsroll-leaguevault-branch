import type { Score } from "./games";
import type { Game } from "./games";
import type { Bowler } from "./bowlers";
import type { Team } from "./teams";

export interface SavedCard {
  id: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface ApiListResponse<T> {
  success: boolean;
  data: T[];
  pagination?: PaginationMeta;
  error?: {
    message: string;
    code?: string;
  };
}

export interface WeeklyStat {
  bowlerLeagueId: number;
  game1: number | null;
  game2: number | null;
  game3: number | null;
  total: number | null;
  handicap: number | null;
}

export interface SeriesWithStats {
  id: number;
  leagueId: number;
  weekNumber: number;
  seriesDate: Date;
  isComplete: boolean;
  stats: WeeklyStat[];
}

export interface WeeklyStatWithBowler extends WeeklyStat {
  bowlerLeague: {
    bowler: Bowler;
    team: Team;
  };
}

export interface DetailedScore extends Score {
  game: Game;
  bowler: Bowler;
  team: Team;
  frameDetails: {
    frameNumber: number;
    rolls: string[];
    score: number;
    isSplit: boolean;
    splitPins?: string;
    notes?: string[];
  }[];
}
