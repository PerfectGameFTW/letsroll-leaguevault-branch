import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { organizations } from "./organizations";
// `userRoleEnum` is the existing `user_role` Postgres enum (see
// `shared/schema/constants.ts`), already used by `users.role`. Reusing
// it for the audit columns means the database itself rejects any value
// outside ('system_admin', 'org_admin', 'user') — a buggy future
// storage helper can't write '' or 'admin' and have the audit table
// silently accept it (task #463). The Zod-side `z.enum(USER_ROLES)`
// validation below stays as a defense-in-depth check at the API edge.
import { USER_ROLES, userRoleEnum } from "./constants";

export const adminRoleChangeAudits = pgTable("admin_role_change_audits", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  targetUserId: integer("target_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  oldRole: userRoleEnum("old_role").notNull(),
  newRole: userRoleEnum("new_role").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("admin_role_change_audits_created_at_idx").on(table.createdAt),
  targetIdx: index("admin_role_change_audits_target_idx").on(table.targetUserId),
  actorIdx: index("admin_role_change_audits_actor_idx").on(table.actorUserId),
}));

export const insertAdminRoleChangeAuditSchema = createInsertSchema(adminRoleChangeAudits)
  .extend({
    actorUserId: z.number().int().positive(),
    targetUserId: z.number().int().positive(),
    organizationId: z.number().int().positive().nullable(),
    oldRole: z.enum(USER_ROLES),
    newRole: z.enum(USER_ROLES),
    ipAddress: z.string().max(64).nullable(),
    userAgent: z.string().max(512).nullable(),
  })
  .omit({ id: true, createdAt: true });

export type AdminRoleChangeAudit = typeof adminRoleChangeAudits.$inferSelect;
export type InsertAdminRoleChangeAudit = z.infer<typeof insertAdminRoleChangeAuditSchema>;
