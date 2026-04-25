import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { organizations } from "./organizations";

export const adminPasswordResetAudits = pgTable("admin_password_reset_audits", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  targetUserId: integer("target_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("admin_password_reset_audits_created_at_idx").on(table.createdAt),
  targetIdx: index("admin_password_reset_audits_target_idx").on(table.targetUserId),
  actorIdx: index("admin_password_reset_audits_actor_idx").on(table.actorUserId),
}));

export const insertAdminPasswordResetAuditSchema = createInsertSchema(adminPasswordResetAudits)
  .extend({
    actorUserId: z.number().int().positive(),
    targetUserId: z.number().int().positive(),
    organizationId: z.number().int().positive().nullable(),
    ipAddress: z.string().max(64).nullable(),
    userAgent: z.string().max(512).nullable(),
  })
  .omit({ id: true, createdAt: true });

export type AdminPasswordResetAudit = typeof adminPasswordResetAudits.$inferSelect;
export type InsertAdminPasswordResetAudit = z.infer<typeof insertAdminPasswordResetAuditSchema>;
