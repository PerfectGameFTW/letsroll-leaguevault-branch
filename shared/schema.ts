import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  weeklyFee: integer("weekly_fee").notNull(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id").notNull(),
  amount: integer("amount").notNull(),
  weekOf: timestamp("week_of").notNull(),
  squarePaymentId: text("square_payment_id"),
  status: text("status").notNull().default("pending"),
  paidAt: timestamp("paid_at"),
});

export const insertUserSchema = createInsertSchema(users);
export const insertBowlerSchema = createInsertSchema(bowlers);
export const insertPaymentSchema = createInsertSchema(payments);

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Bowler = typeof bowlers.$inferSelect;
export type InsertBowler = z.infer<typeof insertBowlerSchema>;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
