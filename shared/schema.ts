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
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  leagueId: integer("league_id").notNull().references(() => leagues.id),
  active: boolean("active").notNull().default(true),
});

export const bowlers = pgTable("bowlers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  teamId: integer("team_id").references(() => teams.id),
  active: boolean("active").notNull().default(true),
  weeklyFee: integer("weekly_fee").notNull(),
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

// Relations
export const leagueRelations = relations(leagues, ({ many }) => ({
  teams: many(teams),
  payments: many(payments),
}));

export const teamRelations = relations(teams, ({ one, many }) => ({
  league: one(leagues, {
    fields: [teams.leagueId],
    references: [leagues.id],
  }),
  bowlers: many(bowlers),
}));

export const bowlerRelations = relations(bowlers, ({ one, many }) => ({
  team: one(teams, {
    fields: [bowlers.teamId],
    references: [teams.id],
  }),
  payments: many(payments),
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

// Schemas for insertion
export const insertUserSchema = createInsertSchema(users);
export const insertLeagueSchema = createInsertSchema(leagues);
export const insertTeamSchema = createInsertSchema(teams);
export const insertBowlerSchema = createInsertSchema(bowlers);
export const insertPaymentSchema = createInsertSchema(payments);

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type League = typeof leagues.$inferSelect;
export type InsertLeague = z.infer<typeof insertLeagueSchema>;

export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;

export type Bowler = typeof bowlers.$inferSelect;
export type InsertBowler = z.infer<typeof insertBowlerSchema>;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;