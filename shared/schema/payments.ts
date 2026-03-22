import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { PAYMENT_STATUSES, PAYMENT_TYPES, positiveIntSchema, dateSchema } from "./constants";
import { bowlers } from "./bowlers";
import { leagues } from "./leagues";

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id")
    .notNull()
    .references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  amount: integer("amount").notNull(),
  lineageAmount: integer("lineage_amount"),
  prizeFundAmount: integer("prize_fund_amount"),
  weekOf: timestamp("week_of", { mode: "string" }).notNull(),
  status: text("status", { enum: PAYMENT_STATUSES }).notNull().default('paid'),
  type: text("type", { enum: PAYMENT_TYPES }).notNull(),
  checkNumber: text("check_number"),
  squarePaymentId: text("square_payment_id"),
  idempotencyKey: text("idempotency_key").unique(),
  squareRefundId: text("square_refund_id"),
  refundReason: text("refund_reason"),
  refundedAt: timestamp("refunded_at", { mode: "string" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  bowlerIdx: index("payments_bowler_idx").on(table.bowlerId),
  leagueIdx: index("payments_league_idx").on(table.leagueId),
  weekOfIdx: index("payments_week_of_idx").on(table.weekOf),
}));

export const paymentSchedules = pgTable("payment_schedules", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id")
    .notNull()
    .references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  frequency: text("frequency", { enum: ["weekly", "monthly", "upfront"] }).notNull(),
  amount: integer("amount").notNull(),
  nextPaymentDate: timestamp("next_payment_date", { mode: "string" }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  lastPaymentDate: timestamp("last_payment_date", { mode: "string" }),
  squareCardId: text("square_card_id").notNull(),
}, (table) => ({
  bowlerScheduleIdx: index("bowler_schedule_idx").on(table.bowlerId, table.leagueId),
  nextPaymentIdx: index("next_payment_idx").on(table.nextPaymentDate),
  activeIdx: index("active_schedule_idx").on(table.active),
}));

const basePaymentSchema = createInsertSchema(payments);
const basePaymentScheduleSchema = createInsertSchema(paymentSchedules);

export const insertPaymentSchema = basePaymentSchema.extend({
  bowlerId: positiveIntSchema,
  leagueId: positiveIntSchema,
  amount: positiveIntSchema,
  lineageAmount: z.number().int().min(0).nullable().optional(),
  prizeFundAmount: z.number().int().min(0).nullable().optional(),
  weekOf: dateSchema,
  status: z.enum(PAYMENT_STATUSES).default("paid"),
  type: z.enum(PAYMENT_TYPES),
  checkNumber: z.string().optional(),
  squarePaymentId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  notes: z.string().optional(),
  storeCard: z.boolean().optional(),
}).omit({ id: true, createdAt: true });

export const insertPaymentScheduleSchema = basePaymentScheduleSchema.extend({
  bowlerId: positiveIntSchema,
  leagueId: positiveIntSchema,
  frequency: z.enum(["weekly", "monthly", "upfront"]),
  amount: positiveIntSchema,
  nextPaymentDate: dateSchema,
  active: z.boolean().default(true),
  squareCardId: z.string(),
}).omit({ id: true, createdAt: true, lastPaymentDate: true });

export const updatePaymentSchema = z.object({
  amount: positiveIntSchema,
  lineageAmount: z.number().int().min(0).nullable(),
  prizeFundAmount: z.number().int().min(0).nullable(),
  weekOf: dateSchema,
  status: z.enum(PAYMENT_STATUSES),
  type: z.enum(PAYMENT_TYPES),
  checkNumber: z.string().nullable(),
  squarePaymentId: z.string().nullable(),
  squareRefundId: z.string().nullable(),
  refundReason: z.string().nullable(),
  refundedAt: dateSchema.nullable(),
  notes: z.string().nullable(),
}).partial();

export const updatePaymentScheduleSchema = z.object({
  frequency: z.enum(["weekly", "monthly", "upfront"]),
  amount: positiveIntSchema,
  nextPaymentDate: dateSchema,
  active: z.boolean(),
  squareCardId: z.string(),
  lastPaymentDate: dateSchema.nullable(),
}).partial();

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type UpdatePayment = z.infer<typeof updatePaymentSchema>;

export type PaymentSchedule = typeof paymentSchedules.$inferSelect;
export type InsertPaymentSchedule = z.infer<typeof insertPaymentScheduleSchema>;
export type UpdatePaymentSchedule = z.infer<typeof updatePaymentScheduleSchema>;
