import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { emailSchema } from "./constants";
import { users } from "./users";

export const DELETION_REQUEST_STATUSES = ["pending", "completed", "rejected"] as const;
export type DeletionRequestStatus = typeof DELETION_REQUEST_STATUSES[number];

export const deletionRequests = pgTable("deletion_requests", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  reason: text("reason"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("deletion_requests_status_idx").on(table.status),
  emailIdx: index("deletion_requests_email_idx").on(table.email),
  createdAtIdx: index("deletion_requests_created_at_idx").on(table.createdAt),
}));

const baseInsert = createInsertSchema(deletionRequests);
export const insertDeletionRequestSchema = baseInsert.extend({
  email: emailSchema,
  reason: z.string().max(2000).nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
}).omit({ id: true, createdAt: true, status: true, adminNote: true, reviewedBy: true, reviewedAt: true });

export const updateDeletionRequestStatusSchema = z.object({
  status: z.enum(["completed", "rejected"]),
  adminNote: z.string().max(2000).nullable().optional(),
});

export type DeletionRequest = typeof deletionRequests.$inferSelect;
export type InsertDeletionRequest = z.infer<typeof insertDeletionRequestSchema>;
export type UpdateDeletionRequestStatus = z.infer<typeof updateDeletionRequestStatusSchema>;
