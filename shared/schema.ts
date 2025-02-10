import { pgTable, text, serial, integer, boolean, timestamp, index, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

// Core tables with improved constraints and relations
export const bowlers = pgTable("bowlers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  active: boolean("active").notNull().default(true),
  squareCustomerId: text("square_customer_id"),
  order: integer("order").notNull().default(0),
});

export const leagues = pgTable("leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  seasonStart: timestamp("season_start").notNull(),
  seasonEnd: timestamp("season_end").notNull(),
  weekDay: text("week_day"),
  practiceStartTime: text("practice_start_time"),
  competitionStartTime: text("competition_start_time"),
  weeklyFee: integer("weekly_fee").notNull().default(2000),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  number: integer("number"),
  leagueId: integer("league_id").notNull().references(() => leagues.id, { onDelete: 'cascade' }),
  active: boolean("active").notNull().default(true),
});

// Improved bowler leagues table with better constraints
export const bowlerLeagues = pgTable("bowler_leagues", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id").notNull().references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id").notNull().references(() => leagues.id, { onDelete: 'cascade' }),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: 'cascade' }),
  active: boolean("active").notNull().default(true),
  order: integer("order").notNull().default(0),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (table) => ({
  // Add unique constraint to prevent duplicate assignments
  uniqueAssignment: unique().on(table.bowlerId, table.leagueId, table.teamId),
  // Add indexes for better query performance
  bowlerIdx: index("bowler_leagues_bowler_idx").on(table.bowlerId),
  leagueIdx: index("bowler_leagues_league_idx").on(table.leagueId),
  teamIdx: index("bowler_leagues_team_idx").on(table.teamId),
}));

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id").notNull().references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id").notNull().references(() => leagues.id, { onDelete: 'cascade' }),
  amount: integer("amount").notNull(),
  weekOf: timestamp("week_of").notNull(),
  squarePaymentId: text("square_payment_id"),
  status: text("status").notNull().default("pending"),
  paidAt: timestamp("paid_at"),
});

// Improved relations with type safety
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

// Improved schema validation with better error messages
export const insertBowlerSchema = createInsertSchema(bowlers, {
  email: z.string().email("Invalid email address"),
  name: z.string().min(1, "Name is required"),
});

export const insertLeagueSchema = createInsertSchema(leagues).extend({
  seasonStart: z.coerce.date(),
  seasonEnd: z.coerce.date(),
  weekDay: z.string().optional(),
  practiceStartTime: z.string().optional(),
  competitionStartTime: z.string().optional(),
  weeklyFee: z.number().min(0, "Weekly fee must be non-negative"),
});

export const insertTeamSchema = createInsertSchema(teams).extend({
  number: z.number().min(1, "Team number must be at least 1"),
});

export const insertBowlerLeagueSchema = createInsertSchema(bowlerLeagues);
export const insertPaymentSchema = createInsertSchema(payments);

// Improved type exports with better naming
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

// API response types for consistent handling
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface ApiListResponse<T> {
  success: boolean;
  data: T[];
  error?: string;
}