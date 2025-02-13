import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Existing table definitions remain unchanged
export const leagues = pgTable("leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  seasonStart: timestamp("season_start").notNull(),
  seasonEnd: timestamp("season_end").notNull(),
  weekDay: text("week_day").notNull(),
  weeklyFee: integer("weekly_fee").notNull().default(2000), // Store in cents
  practiceStartTime: text("practice_start_time"),
  competitionStartTime: text("competition_start_time"),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  number: integer("number").notNull(),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  active: boolean("active").notNull().default(true),
});

export const bowlers = pgTable("bowlers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  active: boolean("active").notNull().default(true),
  order: integer("order").notNull().default(0),
  squareCustomerId: text("square_customer_id"),
  qubicaId: text("qubica_id"), // Added to store QubicaAMF bowler ID
});

// New tables for bowling data
export const series = pgTable("series", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  weekNumber: integer("week_number").notNull(),
  seriesDate: timestamp("series_date").notNull(),
  isComplete: boolean("is_complete").notNull().default(false),
}, (table) => ({
  leagueWeekIdx: index("series_league_week_idx").on(table.leagueId, table.weekNumber),
}));

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id")
    .notNull()
    .references(() => series.id, { onDelete: 'cascade' }),
  bowlerLeagueId: integer("bowler_league_id")
    .notNull()
    .references(() => bowlerLeagues.id, { onDelete: 'cascade' }),
  gameNumber: integer("game_number").notNull(),
  score: integer("score").notNull(),
  handicap: integer("handicap").notNull(),
  laneNumber: integer("lane_number").notNull(),
  status: text("status", { enum: ['regular', 'substitute', 'vacant', 'absent'] }).notNull().default('regular'),
}, (table) => ({
  seriesGameIdx: index("games_series_game_idx").on(table.seriesId, table.gameNumber),
  bowlerGameIdx: index("games_bowler_game_idx").on(table.bowlerLeagueId, table.gameNumber),
}));

export const weeklyStats = pgTable("weekly_stats", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id")
    .notNull()
    .references(() => series.id, { onDelete: 'cascade' }),
  bowlerLeagueId: integer("bowler_league_id")
    .notNull()
    .references(() => bowlerLeagues.id, { onDelete: 'cascade' }),
  average: integer("average").notNull(),
  handicap: integer("handicap").notNull(),
  gamesPlayed: integer("games_played").notNull().default(0),
}, (table) => ({
  bowlerSeriesIdx: index("weekly_stats_bowler_series_idx").on(table.bowlerLeagueId, table.seriesId),
}));

// Keep existing tables unchanged
export const bowlerLeagues = pgTable("bowler_leagues", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id")
    .notNull()
    .references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  active: boolean("active").notNull().default(true),
  order: integer("order").notNull().default(0),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (table) => ({
  bowlerIdx: index("bowler_leagues_bowler_idx").on(table.bowlerId),
  leagueIdx: index("bowler_leagues_league_idx").on(table.leagueId),
  teamIdx: index("bowler_leagues_team_idx").on(table.teamId),
  orderIdx: index("bowler_leagues_order_idx").on(table.teamId, table.leagueId, table.order),
}));

// Keep existing payments table unchanged
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id")
    .notNull()
    .references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  amount: integer("amount").notNull(),
  weekOf: timestamp("week_of").notNull(),
  status: text("status", { enum: ['paid', 'pending', 'failed'] }).notNull().default('paid'),
  type: text("type", { enum: ['cash', 'check', 'credit_card'] }).notNull(),
  checkNumber: text("check_number"),
  squarePaymentId: text("square_payment_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Add new relations
export const seriesRelations = relations(series, ({ one, many }) => ({
  league: one(leagues, {
    fields: [series.leagueId],
    references: [leagues.id],
  }),
  games: many(games),
  weeklyStats: many(weeklyStats),
}));

export const gamesRelations = relations(games, ({ one }) => ({
  series: one(series, {
    fields: [games.seriesId],
    references: [series.id],
  }),
  bowlerLeague: one(bowlerLeagues, {
    fields: [games.bowlerLeagueId],
    references: [bowlerLeagues.id],
  }),
}));

export const weeklyStatsRelations = relations(weeklyStats, ({ one }) => ({
  series: one(series, {
    fields: [weeklyStats.seriesId],
    references: [series.id],
  }),
  bowlerLeague: one(bowlerLeagues, {
    fields: [weeklyStats.bowlerLeagueId],
    references: [bowlerLeagues.id],
  }),
}));

// Update existing relations
export const leagueRelations = relations(leagues, ({ many }) => ({
  teams: many(teams),
  bowlerLeagues: many(bowlerLeagues),
  payments: many(payments),
  series: many(series),
}));

export const teamRelations = relations(teams, ({ one, many }) => ({
  league: one(leagues, {
    fields: [teams.leagueId],
    references: [leagues.id],
  }),
  bowlerLeagues: many(bowlerLeagues),
}));

export const bowlerRelations = relations(bowlers, ({ many }) => ({
  bowlerLeagues: many(bowlerLeagues),
  payments: many(payments),
}));

export const bowlerLeagueRelations = relations(bowlerLeagues, ({ one }) => ({
  bowler: one(bowlers, {
    fields: [bowlerLeagues.bowlerId],
    references: [bowlers.id],
  }),
  league: one(leagues, {
    fields: [bowlerLeagues.leagueId],
    references: [leagues.id],
  }),
  team: one(teams, {
    fields: [bowlerLeagues.teamId],
    references: [teams.id],
  }),
}));


// Add validation schemas
const baseSeriesSchema = z.object({
  leagueId: z.number().positive(),
  weekNumber: z.number().positive(),
  seriesDate: z.coerce.date(),
  isComplete: z.boolean().default(false),
});

const baseGameSchema = z.object({
  seriesId: z.number().positive(),
  bowlerLeagueId: z.number().positive(),
  gameNumber: z.number().positive(),
  score: z.number().min(0),
  handicap: z.number().min(0),
  laneNumber: z.number().positive(),
  status: z.enum(['regular', 'substitute', 'vacant', 'absent']).default('regular'),
});

const baseWeeklyStatsSchema = z.object({
  seriesId: z.number().positive(),
  bowlerLeagueId: z.number().positive(),
  average: z.number().min(0),
  handicap: z.number().min(0),
  gamesPlayed: z.number().min(0).default(0),
});

const baseBowlerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  active: z.boolean().default(true),
  order: z.number().min(0).default(0),
  squareCustomerId: z.string().nullable().optional(),
  qubicaId: z.string().nullable().optional(),
});

const baseLeagueSchema = z.object({
  name: z.string().min(2, "League name must be at least 2 characters"),
  description: z.string().nullable().optional(),
  active: z.boolean().default(true),
  seasonStart: z.coerce.date(),
  seasonEnd: z.coerce.date(),
  weekDay: z.string(),
  practiceStartTime: z.string().optional(),
  competitionStartTime: z.string().optional(),
  weeklyFee: z.number().min(0).default(2000),
});

const baseTeamSchema = z.object({
  name: z.string().min(2, "Team name must be at least 2 characters"),
  number: z.number().int().positive(),
  leagueId: z.number().positive(),
  active: z.boolean().default(true),
});

const baseBowlerLeagueSchema = z.object({
  bowlerId: z.number().positive(),
  leagueId: z.number().positive(),
  teamId: z.number().positive(),
  active: z.boolean().default(true),
  order: z.number().min(0).default(0),
});

const basePaymentSchema = z.object({
  bowlerId: z.number().positive(),
  leagueId: z.number().positive(),
  amount: z.number().positive(),
  weekOf: z.coerce.date(),
  status: z.enum(["paid", "pending", "failed"]).default("paid"),
  type: z.enum(["cash", "check", "credit_card"]),
  checkNumber: z.string().optional(),
  squarePaymentId: z.string().optional(),
  notes: z.string().optional(),
});

// Add back missing insert schemas
export const insertSeriesSchema = baseSeriesSchema;
export const insertGameSchema = baseGameSchema;
export const insertWeeklyStatsSchema = baseWeeklyStatsSchema;
export const insertBowlerSchema = baseBowlerSchema;
export const insertLeagueSchema = baseLeagueSchema;
export const insertTeamSchema = baseTeamSchema;
export const insertBowlerLeagueSchema = baseBowlerLeagueSchema;
export const insertPaymentSchema = basePaymentSchema;

// Add back partial schemas
export const partialSeriesSchema = baseSeriesSchema.partial();
export const partialGameSchema = baseGameSchema.partial();
export const partialWeeklyStatsSchema = baseWeeklyStatsSchema.partial();
export const partialBowlerSchema = baseBowlerSchema.partial();
export const partialLeagueSchema = baseLeagueSchema.partial();
export const partialTeamSchema = baseTeamSchema.partial();
export const partialBowlerLeagueSchema = baseBowlerLeagueSchema.partial();
export const partialPaymentSchema = basePaymentSchema.partial();

// Export types
export type Series = typeof series.$inferSelect;
export type InsertSeries = z.infer<typeof insertSeriesSchema>;

export type Game = typeof games.$inferSelect;
export type InsertGame = z.infer<typeof insertGameSchema>;

export type WeeklyStat = typeof weeklyStats.$inferSelect;
export type InsertWeeklyStat = z.infer<typeof insertWeeklyStatsSchema>;

// Keep existing type exports
export type League = typeof leagues.$inferSelect;
export type InsertLeague = z.infer<typeof insertLeagueSchema>;

export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;

export type Bowler = typeof bowlers.$inferSelect;
export type InsertBowler = z.infer<typeof insertBowlerSchema>;

export type BowlerLeague = typeof bowlerLeagues.$inferSelect;
export type InsertBowlerLeague = z.infer<typeof insertBowlerLeagueSchema>;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

// Keep existing API response types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

export interface ApiListResponse<T> {
  success: boolean;
  data: T[];
  error?: {
    message: string;
    code?: string;
  };
}