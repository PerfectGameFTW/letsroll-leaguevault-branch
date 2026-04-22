import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Per-alert-kind rate-limit state, persisted in the database so
 * multi-instance deployments and rapid restart loops can't bypass
 * the in-process timer that used to live on the alerter singleton.
 *
 * Keyed by `kind` (e.g. "apple_pay_recovery"). `lastSentAt` is the
 * wall-clock time of the last successful claim of the slot;
 * `suppressedCount` counts attempts that were rate-limited since
 * that claim, and is reset back to 0 when a new claim succeeds.
 */
export interface AlerterSummary {
  itemCount: number;
  affectedJobIds: number[];
  itemIds: number[];
  suppressedSinceLastAlert: number;
}

export const alerterState = pgTable("alerter_state", {
  kind: text("kind").primaryKey(),
  lastSentAt: timestamp("last_sent_at", { mode: "date" }).notNull(),
  suppressedCount: integer("suppressed_count").notNull().default(0),
  // Summary of the most recent alert payload, populated by the alerter
  // immediately after a successful send so the admin UI can render an
  // in-app banner describing what just fired (#272).
  lastSummary: jsonb("last_summary").$type<AlerterSummary>(),
  // Timestamp of the most recent *successful* send. Distinct from
  // `lastSentAt`, which is advanced when the rate-limit slot is
  // claimed (i.e. before send succeeds or fails). The admin banner
  // reads this column so a failed send does not surface as "an alert
  // was just sent" (#272).
  lastSummarySentAt: timestamp("last_summary_sent_at", { mode: "date" }),
});

export type AlerterState = typeof alerterState.$inferSelect;
