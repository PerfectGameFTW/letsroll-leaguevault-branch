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
] as const;
export type ApplePayJobStatus = typeof APPLE_PAY_JOB_STATUSES[number];

export const APPLE_PAY_JOB_ITEM_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type ApplePayJobItemStatus = typeof APPLE_PAY_JOB_ITEM_STATUSES[number];

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
