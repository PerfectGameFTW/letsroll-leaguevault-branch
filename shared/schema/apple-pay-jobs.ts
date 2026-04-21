import { pgTable, serial, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";
import { locations } from "./locations";

export const APPLE_PAY_JOB_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "partial",
  "canceled",
] as const;
export type ApplePayJobStatus = typeof APPLE_PAY_JOB_STATUSES[number];

export const APPLE_PAY_JOB_ITEM_STATUSES = [
  "pending",
  // `processing` is set by the worker via an atomic pending->processing
  // claim immediately BEFORE issuing the Square API call. A second worker
  // racing on the same item will see it is no longer pending and skip it,
  // so even multi-instance deployments cannot issue duplicate provider
  // calls. The claim also stamps `claimed_at`; items left in `processing`
  // are only revived to `pending` at startup AFTER the lease expires
  // (see `APPLE_PAY_ITEM_LEASE_MS`), so a fresh instance booting during
  // a rolling restart does NOT reset rows another live instance is
  // actively working on.
  "processing",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type ApplePayJobItemStatus = typeof APPLE_PAY_JOB_ITEM_STATUSES[number];

/**
 * How long a worker's pre-call claim on an item is considered "live"
 * before startup recovery is allowed to revert it. Must be comfortably
 * longer than any realistic provider call (Square Apple Pay registration
 * is sub-second in practice; we leave a wide margin for retries, network
 * blips, and backend GC pauses). 10 minutes is far longer than a single
 * provider call should ever take, but short enough that a truly crashed
 * item is recovered well before any human intervention.
 */
export const APPLE_PAY_ITEM_LEASE_MS = 10 * 60 * 1000;

export const applePayJobs = pgTable("apple_pay_jobs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("pending"),
  totalDomains: integer("total_domains").notNull().default(0),
  succeededCount: integer("succeeded_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  errorMessage: text("error_message"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { mode: "string" }),
  completedAt: timestamp("completed_at", { mode: "string" }),
}, (table) => ({
  statusIdx: index("apple_pay_jobs_status_idx").on(table.status),
  createdAtIdx: index("apple_pay_jobs_created_at_idx").on(table.createdAt),
}));

export const applePayJobItems = pgTable("apple_pay_job_items", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => applePayJobs.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "set null" }),
  domain: text("domain").notNull(),
  status: text("status").notNull().default("pending"),
  message: text("message"),
  processedAt: timestamp("processed_at", { mode: "string" }),
  // Set when a worker pre-claims the item (status=processing). Used by
  // `recoverInterruptedApplePayJobs` to distinguish a crashed worker
  // (lease expired) from a still-live one (lease fresh). Cleared on
  // terminal write so successful items never look "in-flight".
  claimedAt: timestamp("claimed_at", { mode: "string" }),
  // Incremented every time `recoverInterruptedApplePayJobs` reverts this
  // item from `processing` back to `pending` because its lease expired.
  // 0 in the steady state; >0 means a worker observed the item stalled
  // mid-call long enough that recovery had to step in. Surfaced in the
  // admin UI as an anomaly hint per job (#270).
  recoveredCount: integer("recovered_count").notNull().default(0),
}, (table) => ({
  jobIdIdx: index("apple_pay_job_items_job_id_idx").on(table.jobId),
  jobStatusIdx: index("apple_pay_job_items_job_status_idx").on(table.jobId, table.status),
  // Idempotency guard: re-running enumeration for the same job cannot
  // create duplicate (org, location, domain) rows.
  uniquePerJob: uniqueIndex("apple_pay_job_items_unique_idx").on(
    table.jobId,
    sql`COALESCE(${table.organizationId}, 0)`,
    sql`COALESCE(${table.locationId}, 0)`,
    table.domain,
  ),
}));

export type ApplePayJob = typeof applePayJobs.$inferSelect;
export type ApplePayJobItem = typeof applePayJobItems.$inferSelect;
