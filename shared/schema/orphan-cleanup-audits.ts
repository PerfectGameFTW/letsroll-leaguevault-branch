import { pgTable, text, serial, integer, timestamp, index, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
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

export const ORPHAN_CLEANUP_ACTIONS = ["reassign", "delete", "undo_reassign"] as const;
export type OrphanCleanupAction = typeof ORPHAN_CLEANUP_ACTIONS[number];

export const orphanCleanupAudits = pgTable("orphan_cleanup_audits", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  resourceType: text("resource_type").notNull(),
  resourceId: integer("resource_id").notNull(),
  action: text("action").notNull(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  // For reassign rows: the org the row belonged to before the reassign (always
  // null today since orphans are by definition org-less, but recorded
  // explicitly so undo restores the prior state instead of guessing).
  previousOrganizationId: integer("previous_organization_id").references(() => organizations.id, { onDelete: "set null" }),
  // For delete rows: a JSON snapshot of the row that was deleted, so an admin
  // can reconstruct the data manually if the delete turns out to be wrong.
  snapshot: jsonb("snapshot"),
  // Set when this audit row has been undone by a later admin action. Once set,
  // the row can no longer be undone again.
  undoneAt: timestamp("undone_at", { mode: "string" }),
  undoneByAuditId: integer("undone_by_audit_id").references((): AnyPgColumn => orphanCleanupAudits.id, { onDelete: "set null" }),
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
    previousOrganizationId: z.number().int().positive().nullable().optional(),
    snapshot: z.unknown().nullable().optional(),
    undoneAt: z.string().nullable().optional(),
    undoneByAuditId: z.number().int().positive().nullable().optional(),
  })
  .omit({ id: true, createdAt: true });

export type OrphanCleanupAudit = typeof orphanCleanupAudits.$inferSelect;
export type InsertOrphanCleanupAudit = z.infer<typeof insertOrphanCleanupAuditSchema>;
