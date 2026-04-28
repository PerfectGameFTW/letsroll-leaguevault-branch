import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { PAYMENT_STATUSES, PAYMENT_TYPES, SCHEDULE_FREQUENCIES, positiveIntSchema, dateSchema } from "./constants";
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
  providerPaymentId: text("provider_payment_id"),
  cloverChargeId: text("clover_charge_id"),
  idempotencyKey: text("idempotency_key").unique(),
  squareRefundId: text("square_refund_id"),
  refundReason: text("refund_reason"),
  refundedAt: timestamp("refunded_at", { mode: "string" }),
  // Square auto-emails a hosted receipt to `buyerEmailAddress` whenever a
  // CreatePayment / RefundPayment includes one. We persist the URL +
  // human-readable receipt number Square returns so we can render a
  // "View receipt" link in the UI without a second API round-trip, and
  // so Resend Receipt has something concrete to email out. Clover
  // Ecommerce does not emit hosted receipts, so these stay null for
  // that provider. See task #503.
  receiptUrl: text("receipt_url"),
  receiptNumber: text("receipt_number"),
  // True when a paid card row was created without a buyer email — i.e.
  // Square never auto-emailed the bowler a receipt at charge time.
  // Surfaces as a "no receipt sent" badge in admin UI + as a notice on
  // the refund dialog (refunds inherit the original payment's email).
  receiptEmailMissing: boolean("receipt_email_missing").notNull().default(false),
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
  frequency: text("frequency", { enum: SCHEDULE_FREQUENCIES }).notNull(),
  amount: integer("amount").notNull(),
  nextPaymentDate: timestamp("next_payment_date", { mode: "string" }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  lastPaymentDate: timestamp("last_payment_date", { mode: "string" }),
  paymentCardId: text("payment_card_id").notNull(),
  cancelledAt: timestamp("cancelled_at", { mode: "string" }),
  cancelReason: text("cancel_reason"),
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
  providerPaymentId: z.string().optional(),
  cloverChargeId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  receiptUrl: z.string().optional(),
  receiptNumber: z.string().optional(),
  receiptEmailMissing: z.boolean().optional().default(false),
  notes: z.string().optional(),
  storeCard: z.boolean().optional(),
}).omit({ id: true, createdAt: true });

export const insertPaymentScheduleSchema = basePaymentScheduleSchema.extend({
  bowlerId: positiveIntSchema,
  leagueId: positiveIntSchema,
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  amount: positiveIntSchema,
  nextPaymentDate: dateSchema,
  active: z.boolean().default(true),
  paymentCardId: z.string(),
}).omit({ id: true, createdAt: true, lastPaymentDate: true, cancelledAt: true, cancelReason: true });

export const updatePaymentSchema = z.object({
  amount: positiveIntSchema,
  lineageAmount: z.number().int().min(0).nullable(),
  prizeFundAmount: z.number().int().min(0).nullable(),
  weekOf: dateSchema,
  status: z.enum(PAYMENT_STATUSES),
  type: z.enum(PAYMENT_TYPES),
  checkNumber: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  cloverChargeId: z.string().nullable(),
  squareRefundId: z.string().nullable(),
  refundReason: z.string().nullable(),
  refundedAt: dateSchema.nullable(),
  receiptUrl: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  receiptEmailMissing: z.boolean(),
  notes: z.string().nullable(),
}).partial();

export const updatePaymentScheduleSchema = z.object({
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  amount: positiveIntSchema,
  nextPaymentDate: dateSchema,
  active: z.boolean(),
  paymentCardId: z.string(),
  lastPaymentDate: dateSchema.nullable(),
  cancelledAt: dateSchema.nullable(),
  cancelReason: z.string().nullable(),
}).partial();

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type UpdatePayment = z.infer<typeof updatePaymentSchema>;

export type PaymentSchedule = typeof paymentSchedules.$inferSelect;
export type InsertPaymentSchedule = z.infer<typeof insertPaymentScheduleSchema>;
export type UpdatePaymentSchedule = z.infer<typeof updatePaymentScheduleSchema>;
