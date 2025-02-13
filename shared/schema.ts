import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Database table definitions
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
  qubicaId: text("qubica_id").unique(), // QubicaAMF league ID
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  number: integer("number").notNull(),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  active: boolean("active").notNull().default(true),
}, (table) => ({
  // Unique index for league_id + number combination
  leagueNumberIdx: index("teams_league_number_idx").on(table.leagueId, table.number),
}));

export const bowlers = pgTable("bowlers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  active: boolean("active").notNull().default(true),
  order: integer("order").notNull().default(0),
  squareCustomerId: text("square_customer_id"),
  qubicaId: text("qubica_id").unique(), // QubicaAMF bowler ID
});

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
  bowlerIdx: index().on(table.bowlerId),
  leagueIdx: index().on(table.leagueId),
  teamIdx: index().on(table.teamId),
  orderIdx: index().on(table.teamId, table.leagueId, table.order),
  // Unique composite index for active bowler-league-team combinations
  activeBowlerIdx: index("bowler_leagues_active_unique_idx").on(
    table.bowlerId, 
    table.leagueId,
    table.teamId,
    table.active
  ),
}));

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id")
    .notNull()
    .references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  amount: integer("amount").notNull(), // Store in cents
  weekOf: timestamp("week_of").notNull(),
  status: text("status", { enum: ['paid', 'pending', 'failed'] }).notNull().default('paid'),
  type: text("type", { enum: ['cash', 'check', 'credit_card'] }).notNull(),
  checkNumber: text("check_number"),
  squarePaymentId: text("square_payment_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Add new tables after the existing ones
export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  weekNumber: integer("week_number").notNull(),
  gameNumber: integer("game_number").notNull(), // 1, 2, or 3
  date: timestamp("date").notNull(),
}, (table) => ({
  leagueGameIdx: index("league_game_idx").on(table.leagueId, table.weekNumber, table.gameNumber),
}));

export const scores = pgTable("scores", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id")
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  bowlerId: integer("bowler_id")
    .notNull()
    .references(() => bowlers.id, { onDelete: 'cascade' }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  score: integer("score").notNull(),
  handicap: integer("handicap").notNull(),
  average: integer("average").notNull(),
  position: integer("position").notNull(), // Position in the team (1-4)
  isVacant: boolean("is_vacant").notNull().default(false),
  isAbsent: boolean("is_absent").notNull().default(false),
  isSub: boolean("is_sub").notNull().default(false),
  laneNumber: integer("lane_number").notNull(),
}, (table) => ({
  gameScoreIdx: index("game_score_idx").on(table.gameId, table.teamId, table.position),
  bowlerScoreIdx: index("bowler_score_idx").on(table.bowlerId),
}));

// Relations
export const leagueRelations = relations(leagues, ({ many }) => ({
  teams: many(teams),
  bowlerLeagues: many(bowlerLeagues),
  payments: many(payments),
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

// Add relations for the new tables
export const gameRelations = relations(games, ({ one, many }) => ({
  league: one(leagues, {
    fields: [games.leagueId],
    references: [leagues.id],
  }),
  scores: many(scores),
}));

export const scoreRelations = relations(scores, ({ one }) => ({
  game: one(games, {
    fields: [scores.gameId],
    references: [games.id],
  }),
  bowler: one(bowlers, {
    fields: [scores.bowlerId],
    references: [bowlers.id],
  }),
  team: one(teams, {
    fields: [scores.teamId],
    references: [teams.id],
  }),
}));


// Validation schemas
const baseBowlerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  active: z.boolean().default(true),
  order: z.number().min(0).default(0),
  squareCustomerId: z.string().nullable().optional(),
  qubicaId: z.string().nullable().optional(), // Add validation for qubicaId
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

// Add validation schemas for the new tables
const baseGameSchema = z.object({
  leagueId: z.number().positive(),
  weekNumber: z.number().positive(),
  gameNumber: z.number().min(1).max(3),
  date: z.coerce.date(),
});

const baseScoreSchema = z.object({
  gameId: z.number().positive(),
  bowlerId: z.number().positive(),
  teamId: z.number().positive(),
  score: z.number().min(0).max(300),
  handicap: z.number().min(0),
  average: z.number().min(0),
  position: z.number().min(1).max(4),
  isVacant: z.boolean().default(false),
  isAbsent: z.boolean().default(false),
  isSub: z.boolean().default(false),
  laneNumber: z.number().positive(),
});

// Export schemas for validation
export const insertBowlerSchema = baseBowlerSchema;
export const insertLeagueSchema = baseLeagueSchema;
export const insertTeamSchema = baseTeamSchema;
export const insertBowlerLeagueSchema = baseBowlerLeagueSchema;
export const insertPaymentSchema = basePaymentSchema;
export const insertGameSchema = baseGameSchema;
export const insertScoreSchema = baseScoreSchema;

// Export partial schemas for updates
export const partialBowlerSchema = baseBowlerSchema.partial();
export const partialLeagueSchema = baseLeagueSchema.partial();
export const partialTeamSchema = baseTeamSchema.partial();
export const partialBowlerLeagueSchema = baseBowlerLeagueSchema.partial();
export const partialPaymentSchema = basePaymentSchema.partial();
export const partialGameSchema = baseGameSchema.partial();
export const partialScoreSchema = baseScoreSchema.partial();

// Type exports
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

// Type exports for the new tables
export type Game = typeof games.$inferSelect;
export type InsertGame = z.infer<typeof insertGameSchema>;

export type Score = typeof scores.$inferSelect;
export type InsertScore = z.infer<typeof insertScoreSchema>;

// API response types
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