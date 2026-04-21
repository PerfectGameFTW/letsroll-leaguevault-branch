import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { organizations } from "./organizations";

export const ORPHAN_CLEANUP_RESOURCE_TYPES = [
  "leagues",
  "teams",
  "bowlerLeagues",
  "payments",
  "users",
] as const;
export type OrphanCleanupResourceType = typeof ORPHAN_CLEANUP_RESOURCE_TYPES[number];

export const ORPHAN_CLEANUP_ACTIONS = ["reassign", "delete"] as const;
export type OrphanCleanupAction = typeof ORPHAN_CLEANUP_ACTIONS[number];

export const orphanCleanupAudits = pgTable("orphan_cleanup_audits", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  resourceType: text("resource_type").notNull(),
  resourceId: integer("resource_id").notNull(),
  action: text("action").notNull(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("orphan_cleanup_audits_created_at_idx").on(table.createdAt),
  resourceIdx: index("orphan_cleanup_audits_resource_idx").on(table.resourceType, table.resourceId),
}));

export const insertOrphanCleanupAuditSchema = createInsertSchema(orphanCleanupAudits)
  .extend({
    resourceType: z.enum(ORPHAN_CLEANUP_RESOURCE_TYPES),
    action: z.enum(ORPHAN_CLEANUP_ACTIONS),
    organizationId: z.number().int().positive().nullable().optional(),
  })
  .omit({ id: true, createdAt: true });

export type OrphanCleanupAudit = typeof orphanCleanupAudits.$inferSelect;
export type InsertOrphanCleanupAudit = z.infer<typeof insertOrphanCleanupAuditSchema>;
