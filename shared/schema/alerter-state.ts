import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

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
export const alerterState = pgTable("alerter_state", {
  kind: text("kind").primaryKey(),
  lastSentAt: timestamp("last_sent_at", { mode: "date" }).notNull(),
  suppressedCount: integer("suppressed_count").notNull().default(0),
});

export type AlerterState = typeof alerterState.$inferSelect;
