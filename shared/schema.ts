import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
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
  leagueId: integer("league_id").notNull().references(() => leagues.id),
  active: boolean("active").notNull().default(true),
});

export const bowlers = pgTable("bowlers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  active: boolean("active").notNull().default(true),
  squareCustomerId: text("square_customer_id"),
});

export const bowlerTeams = pgTable("bowler_teams", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id").notNull().references(() => bowlers.id),
  teamId: integer("team_id").notNull().references(() => teams.id),
  leagueId: integer("league_id").notNull().references(() => leagues.id),
  active: boolean("active").notNull().default(true),
  order: integer("order").notNull().default(0),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id").notNull().references(() => bowlers.id),
  leagueId: integer("league_id").notNull().references(() => leagues.id),
  amount: integer("amount").notNull(),
  weekOf: timestamp("week_of").notNull(),
  squarePaymentId: text("square_payment_id"),
  status: text("status").notNull().default("pending"),
  paidAt: timestamp("paid_at"),
});

export const bowlerLeagues = pgTable("bowler_leagues", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id").notNull().references(() => bowlers.id),
  leagueId: integer("league_id").notNull().references(() => leagues.id),
  active: boolean("active").notNull().default(true),
});

export const leagueRelations = relations(leagues, ({ many }) => ({
  teams: many(teams),
  bowlerLeagues: many(bowlerLeagues),
  bowlerTeams: many(bowlerTeams),
  payments: many(payments),
}));

export const teamRelations = relations(teams, ({ one, many }) => ({
  league: one(leagues, {
    fields: [teams.leagueId],
    references: [leagues.id],
  }),
  bowlerTeams: many(bowlerTeams),
}));

export const bowlerRelations = relations(bowlers, ({ many }) => ({
  bowlerTeams: many(bowlerTeams),
  bowlerLeagues: many(bowlerLeagues),
  payments: many(payments),
}));

export const bowlerTeamRelations = relations(bowlerTeams, ({ one }) => ({
  bowler: one(bowlers, {
    fields: [bowlerTeams.bowlerId],
    references: [bowlers.id],
  }),
  team: one(teams, {
    fields: [bowlerTeams.teamId],
    references: [teams.id],
  }),
  league: one(leagues, {
    fields: [bowlerTeams.leagueId],
    references: [leagues.id],
  }),
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
}));

export const paymentRelations = relations(payments, ({ one }) => ({
  bowler: one(bowlers, {
    fields: [payments.bowlerId],
    references: [bowlers.id],
  }),
  league: one(leagues, {
    fields: [payments.leagueId],
    references: [leagues.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users);
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
export const insertBowlerSchema = createInsertSchema(bowlers).extend({
  teamAssignments: z.array(z.object({
    teamId: z.number(),
    leagueId: z.number(),
  })).optional(),
  leagueIds: z.array(z.number()).optional(),
});
export const insertBowlerLeagueSchema = createInsertSchema(bowlerLeagues);
export const insertPaymentSchema = createInsertSchema(payments);
export const insertBowlerTeamSchema = createInsertSchema(bowlerTeams);

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

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

export type BowlerTeam = typeof bowlerTeams.$inferSelect;
export type InsertBowlerTeam = typeof bowlerTeams.$inferSelect;