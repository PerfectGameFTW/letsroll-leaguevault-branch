import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Per-alert-kind rate-limit state, persisted in the database so
 * multi-instance deployments and rapid restart loops can't bypass
 * the in-process timer that used to live on the alerter singleton.
 *
 * Keyed by `kind`. Two conventions for the `kind` string are in use:
 *   - Bare kind, e.g. `"apple_pay_recovery"` — one global slot, one
 *     summary, used when an alert is intrinsically singleton
 *     (worker-wide events).
 *   - Compound kind, e.g. `"square_catalog_cap:loc:42"` — one slot
 *     per resource so support gets one notification per affected
 *     tenant inside the rate-limit window. The `kind` prefix
 *     (`square_catalog_cap:`) is what the listing endpoint groups
 *     on; see `listRecentAlerterEventsByPrefix` in
 *     `server/storage/alerter-state.ts`.
 *
 * `lastSentAt` is the wall-clock time of the last successful claim
 * of the slot; `suppressedCount` counts attempts that were
 * rate-limited since that claim, and is reset back to 0 when a new
 * claim succeeds.
 */
export interface ApplePayRecoveryAlerterSummary {
  itemCount: number;
  affectedJobIds: number[];
  itemIds: number[];
  suppressedSinceLastAlert: number;
}

/**
 * Summary persisted when an organization's Square catalog hits the
 * pagination safety cap (Task #644). One row per location: the
 * `kind` is `"square_catalog_cap:loc:<locationId>"` so support sees
 * one alert per affected tenant rather than one global alert that
 * shadows whichever org happened to fire most recently.
 */
export interface SquareCatalogCapAlerterSummary {
  organizationId: number | null;
  locationId: number;
  reason: "max_items" | "max_pages";
  context: string;
  suppressedSinceLastAlert: number;
}

/**
 * Summary persisted when the daily league Square-catalog audit
 * (Task #654) finds a saved Lineage / Prize Fund variation id that
 * is no longer in the live Square catalog. One row per league: the
 * `kind` is `"league_square_missing:<leagueId>"` so each affected
 * league surfaces independently and is independently rate-limited.
 *
 * The leagues-page banner (Task #657) reads
 * `listRecentAlerterEventsByPrefix("league_square_missing:")` and
 * pairs each row with the current `League` row so it can auto-clear
 * the moment the admin re-points the league at a live variation id
 * (the saved variation id no longer matches what was reported
 * missing).
 */
export interface LeagueSquareMissingAlerterSummary {
  leagueId: number;
  leagueName: string;
  organizationId: number | null;
  missing: Array<{
    kind: "lineage" | "prizeFund";
    itemName: string | null;
    variationId: string;
  }>;
  suppressedSinceLastAlert: number;
}

/**
 * Discriminated by shape, not by an explicit tag — older rows
 * predate the union, and the JSONB column is read by code that
 * already knows which `kind` it asked for.
 */
export type AlerterSummary =
  | ApplePayRecoveryAlerterSummary
  | SquareCatalogCapAlerterSummary
  | LeagueSquareMissingAlerterSummary;

export const alerterState = pgTable("alerter_state", {
  kind: text("kind").primaryKey(),
  lastSentAt: timestamp("last_sent_at", { mode: "date" }).notNull(),
  suppressedCount: integer("suppressed_count").notNull().default(0),
  // Summary of the most recent alert payload, populated by the alerter
  // immediately after a successful send so the admin UI can render an
  // in-app banner describing what just fired (#272, #644).
  lastSummary: jsonb("last_summary").$type<AlerterSummary>(),
  // Timestamp of the most recent *successful* send. Distinct from
  // `lastSentAt`, which is advanced when the rate-limit slot is
  // claimed (i.e. before send succeeds or fails). The admin banner
  // reads this column so a failed send does not surface as "an alert
  // was just sent" (#272).
  lastSummarySentAt: timestamp("last_summary_sent_at", { mode: "date" }),
});

export type AlerterState = typeof alerterState.$inferSelect;
