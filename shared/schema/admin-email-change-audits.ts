import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";

// Audit trail for `PATCH /api/account/profile/:id` when a system_admin
// initiates an email change for *another* user (task #325). Self-serve
// edits (`actorUserId === targetUserId`) do NOT write a row here — the
// PATCH already logs those at INFO and they aren't an after-the-fact
// concern. The row is written in the same DB transaction as the
// `email_change_requests` insert so the two cannot disagree.
//
// Stored emails are masked at the call site (see `maskEmail`) so the
// table never holds the full address — enough context for triage,
// nothing extra to leak. The `sentAt` timestamp matches when the
// confirmation token was issued.
export const adminEmailChangeAudits = pgTable("admin_email_change_audits", {
  id: serial("id").primaryKey(),
  // The system admin who initiated the change. `restrict` so the audit
  // row survives a user-soft-delete; the FK guarantees the admin row
  // existed at the time of the action.
  actorUserId: integer("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  // The user whose login email is being rerouted.
  targetUserId: integer("target_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  // Both stored already-masked (e.g. "j***@example.com").
  oldEmailMasked: text("old_email_masked").notNull(),
  newEmailMasked: text("new_email_masked").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("admin_email_change_audits_created_at_idx").on(table.createdAt),
  targetIdx: index("admin_email_change_audits_target_idx").on(table.targetUserId),
}));

export const insertAdminEmailChangeAuditSchema = createInsertSchema(adminEmailChangeAudits)
  .extend({
    actorUserId: z.number().int().positive(),
    targetUserId: z.number().int().positive(),
    oldEmailMasked: z.string().min(1),
    newEmailMasked: z.string().min(1),
  })
  .omit({ id: true, createdAt: true });

export type AdminEmailChangeAudit = typeof adminEmailChangeAudits.$inferSelect;
export type InsertAdminEmailChangeAudit = z.infer<typeof insertAdminEmailChangeAuditSchema>;
