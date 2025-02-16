import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enum definitions
export const WeekDay = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
} as const;

export const PaymentStatus = {
  PAID: 'paid',
  PENDING: 'pending',
  FAILED: 'failed',
} as const;

export const PaymentType = {
  CASH: 'cash',
  CHECK: 'check',
  CREDIT_CARD: 'credit_card',
} as const;

// Date validation schemas
const dateSchema = z.coerce.date()
  .refine((date) => !isNaN(date.getTime()), {
    message: "Invalid date format",
  })
  .transform((date) => new Date(date.toISOString())); // Normalize to UTC

const timeFormatRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
const timeSchema = z.string().regex(timeFormatRegex, "Invalid time format. Use HH:MM (24-hour)");

// Common validation rules
const nameSchema = z.string().min(2, "Name must be at least 2 characters");
const emailSchema = z.string().email("Invalid email address");
const positiveIntSchema = z.number().int().positive("Must be a positive number");

// Database table definitions
export const leagues = pgTable("leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  seasonStart: timestamp("season_start", { mode: "date" }).notNull(),
  seasonEnd: timestamp("season_end", { mode: "date" }).notNull(),
  weekDay: text("week_day", { enum: Object.values(WeekDay) }).notNull(),
  weeklyFee: integer("weekly_fee").notNull().default(2000),
  practiceStartTime: text("practice_start_time"),
  competitionStartTime: text("competition_start_time"),
  qubicaId: text("qubica_id").unique(),
}, (table) => ({
  activeNameIdx: index("leagues_active_name_idx").on(table.active, table.name),
  seasonIdx: index("leagues_season_idx").on(table.seasonStart, table.seasonEnd)
}));

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
  qubicaId: text("qubica_id").unique(),
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
  status: text("status", { enum: Object.values(PaymentStatus) }).notNull().default('paid'),
  type: text("type", { enum: Object.values(PaymentType) }).notNull(),
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
  date: timestamp("date", { mode: 'date' }).notNull(),
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
  position: integer("position").notNull(),
  isVacant: boolean("is_vacant").notNull().default(false),
  isAbsent: boolean("is_absent").notNull().default(false),
  isSub: boolean("is_sub").notNull().default(false),
  laneNumber: integer("lane_number").notNull(),
  frames: text().array().notNull().default(sql`'{}'`),
  splits: text().array().notNull().default(sql`'{}'`),
  notes: text().array().notNull().default(sql`'{}'`),
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
// Base schemas using drizzle-zod
const baseBowlerSchema = createInsertSchema(bowlers);
const baseLeagueSchema = createInsertSchema(leagues);
const baseTeamSchema = createInsertSchema(teams);
const baseBowlerLeagueSchema = createInsertSchema(bowlerLeagues);
const basePaymentSchema = createInsertSchema(payments);
const baseGameSchema = createInsertSchema(games);
const baseScoreSchema = createInsertSchema(scores);

// Enhanced insert schemas with additional validation
export const insertBowlerSchema = baseBowlerSchema.extend({
  name: nameSchema,
  email: emailSchema,
  active: z.boolean().default(true),
  order: z.number().min(0).default(0),
  squareCustomerId: z.string().nullable().optional(),
  qubicaId: z.string().nullable().optional(),
}).omit({ id: true });

export const insertLeagueSchema = baseLeagueSchema.extend({
  name: nameSchema,
  description: z.string().nullable().optional(),
  active: z.boolean().default(true),
  seasonStart: dateSchema,
  seasonEnd: dateSchema,
  weekDay: z.enum(Object.values(WeekDay)),
  weeklyFee: positiveIntSchema.default(2000),
  practiceStartTime: timeSchema.optional(),
  competitionStartTime: timeSchema.optional(),
  qubicaId: z.string().nullable().optional(),
}).omit({ id: true })
  .refine(
    (data) => data.seasonEnd > data.seasonStart,
    "Season end date must be after season start date"
  );

export const insertTeamSchema = baseTeamSchema.extend({
  name: nameSchema,
  number: positiveIntSchema,
  leagueId: positiveIntSchema,
  active: z.boolean().default(true),
}).omit({ id: true });

export const insertBowlerLeagueSchema = baseBowlerLeagueSchema.extend({
  bowlerId: positiveIntSchema,
  leagueId: positiveIntSchema,
  teamId: positiveIntSchema,
  active: z.boolean().default(true),
  order: z.number().min(0).default(0),
}).omit({ id: true });

export const insertPaymentSchema = basePaymentSchema.extend({
  bowlerId: positiveIntSchema,
  leagueId: positiveIntSchema,
  amount: positiveIntSchema,
  weekOf: dateSchema,
  status: z.enum(Object.values(PaymentStatus)).default("paid"),
  type: z.enum(Object.values(PaymentType)),
  checkNumber: z.string().optional(),
  squarePaymentId: z.string().optional(),
  notes: z.string().optional(),
}).omit({ id: true, createdAt: true });

export const insertGameSchema = baseGameSchema.extend({
  leagueId: positiveIntSchema,
  weekNumber: positiveIntSchema,
  gameNumber: z.number().min(1).max(3),
  date: dateSchema,
}).omit({ id: true });

export const insertScoreSchema = baseScoreSchema.extend({
  gameId: positiveIntSchema,
  bowlerId: positiveIntSchema,
  teamId: positiveIntSchema,
  score: z.number().min(0).max(300),
  handicap: z.number().min(0),
  average: z.number().min(0),
  position: z.number().min(1).max(4),
  isVacant: z.boolean().default(false),
  isAbsent: z.boolean().default(false),
  isSub: z.boolean().default(false),
  laneNumber: positiveIntSchema,
  frames: z.array(z.string()).default([]),
  splits: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
}).omit({ id: true });

// Export partial schemas for updates
export const partialBowlerSchema = z.object(baseBowlerSchema.shape).partial();
export const partialLeagueSchema = z.object({
  name: nameSchema,
  description: z.string().nullable(),
  active: z.boolean(),
  seasonStart: dateSchema,
  seasonEnd: dateSchema,
  weekDay: z.enum(Object.values(WeekDay)),
  weeklyFee: positiveIntSchema,
  practiceStartTime: timeSchema,
  competitionStartTime: timeSchema,
  qubicaId: z.string().nullable(),
}).partial().refine(
  (data) => {
    if (data.seasonStart && data.seasonEnd) {
      return data.seasonEnd > data.seasonStart;
    }
    return true;
  },
  "Season end date must be after season start date"
);
export const partialTeamSchema = z.object(baseTeamSchema.shape).partial();
export const partialBowlerLeagueSchema = z.object(baseBowlerLeagueSchema.shape).partial();
export const partialPaymentSchema = z.object(basePaymentSchema.shape).partial();
export const partialGameSchema = z.object(baseGameSchema.shape).partial();
export const partialScoreSchema = z.object(baseScoreSchema.shape).partial();

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

// QubicaAMF Score Import Types
export interface QubicaScoreFileHeader {
  date: Date;
  centerName: string;
  leagueName: string;
  weekNumber: number;
  sessionTime: string;
  leagueId: string;
  description: string;
}

export interface QubicaBowlerScore {
  teamNumber: string;
  gameNumber: number;
  position: number;
  recordNumber: number;
  bowlerId: string;
  status: {
    isVacant: boolean;
    isAbsent: boolean;
    isSub: boolean;
  };
  score: number;
  laneNumber: number;
  bowlerName: string;
  scoreSheet: string;
  handicap: number;
  average: number;
  hasBumpers: boolean;
}

export interface QubicaTeamGame {
  teamNumber: string;
  gameNumber: number;
  teamName: string;
  laneNumber: number;
  bowlers: QubicaBowlerScore[];
}

export interface QubicaScoreImport {
  header: QubicaScoreFileHeader;
  games: QubicaTeamGame[];
}

// Extend existing schemas with QubicaAMF-specific fields
export const importGameSchema = insertGameSchema.extend({
  qubicaWeekNumber: positiveIntSchema,
  qubicaSessionTime: z.string(),
});

export const importScoreSchema = insertScoreSchema.extend({
  qubicaBowlerId: z.string(),
  qubicaTeamNumber: z.string(),
  scoreSheet: z.string(),
});

// Export additional types for the import process
export type ImportGame = z.infer<typeof importGameSchema>;
export type ImportScore = z.infer<typeof importScoreSchema>;