import { pgTable, text, serial, integer, boolean, timestamp, index, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Database table definitions remain unchanged
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

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

export const bowlerLeagues = pgTable("bowler_leagues", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id").notNull().references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id").notNull().references(() => leagues.id, { onDelete: 'cascade' }),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: 'cascade' }),
  active: boolean("active").notNull().default(true),
  order: integer("order").notNull().default(0),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (table) => ({
  uniqueAssignment: unique().on(table.bowlerId, table.leagueId, table.teamId),
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

// Relations remain unchanged
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

// Base schemas
const baseBowlerSchema = z.object({
  name: z.string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must not exceed 100 characters")
    .regex(/^[a-zA-Z\s-']+$/, "Name can only contain letters, spaces, hyphens, and apostrophes"),
  email: z.string().email("Invalid email address")
    .min(3, "Email must be at least 3 characters")
    .max(255, "Email must not exceed 255 characters"),
  active: z.boolean().default(true),
  order: z.number().min(0, "Order must be non-negative").default(0),
  squareCustomerId: z.string().nullable().optional(),
});

const baseLeagueSchema = z.object({
  name: z.string().min(2, "League name must be at least 2 characters"),
  description: z.string().nullable().optional(),
  active: z.boolean().default(true),
  seasonStart: z.coerce.date(),
  seasonEnd: z.coerce.date(),
  weekDay: z.string()
    .regex(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/, "Invalid week day")
    .optional(),
  practiceStartTime: z.string()
    .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)")
    .optional(),
  competitionStartTime: z.string()
    .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)")
    .optional(),
  weeklyFee: z.number()
    .min(0, "Weekly fee must be non-negative")
    .max(1000000, "Weekly fee cannot exceed 10,000")
    .multipleOf(100, "Weekly fee must be in whole dollars"),
});

const baseTeamSchema = z.object({
  name: z.string()
    .min(2, "Team name must be at least 2 characters")
    .max(100, "Team name must not exceed 100 characters"),
  number: z.number()
    .min(1, "Team number must be at least 1")
    .max(999, "Team number must not exceed 999")
    .int("Team number must be an integer"),
  leagueId: z.number().positive("League ID is required"),
  active: z.boolean().default(true),
});

const baseBowlerLeagueSchema = z.object({
  bowlerId: z.number().positive("Bowler ID is required"),
  leagueId: z.number().positive("League ID is required"),
  teamId: z.number().positive("Team ID is required"),
  order: z.number().min(0, "Order must be non-negative").default(0),
  active: z.boolean().default(true),
});

const basePaymentSchema = z.object({
  bowlerId: z.number().positive("Bowler ID is required"),
  leagueId: z.number().positive("League ID is required"),
  amount: z.number()
    .min(100, "Payment amount must be at least $1")
    .max(1000000, "Payment amount cannot exceed $10,000")
    .multipleOf(100, "Payment amount must be in whole dollars"),
  weekOf: z.coerce.date(),
  status: z.enum(["pending", "paid", "failed", "refunded"], {
    errorMap: () => ({ message: "Invalid payment status" })
  }).default("pending"),
  squarePaymentId: z.string().optional(),
});

// Create insert schemas with validation
export const insertBowlerSchema = baseBowlerSchema;
export const insertLeagueSchema = baseLeagueSchema.refine(
  data => data.seasonEnd > data.seasonStart,
  "Season end date must be after season start date"
);
export const insertTeamSchema = baseTeamSchema;
export const insertBowlerLeagueSchema = baseBowlerLeagueSchema;
export const insertPaymentSchema = basePaymentSchema.refine(
  data => {
    const now = new Date();
    const threeMonthsAgo = new Date(now.setMonth(now.getMonth() - 3));
    return data.weekOf >= threeMonthsAgo;
  },
  "Week of date cannot be more than 3 months in the past"
);

// Create partial schemas from base schemas
export const partialBowlerSchema = baseBowlerSchema.partial();
export const partialLeagueSchema = baseLeagueSchema.partial();
export const partialTeamSchema = baseTeamSchema.partial();
export const partialBowlerLeagueSchema = baseBowlerLeagueSchema.partial();
export const partialPaymentSchema = basePaymentSchema.partial();

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

// API response types
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