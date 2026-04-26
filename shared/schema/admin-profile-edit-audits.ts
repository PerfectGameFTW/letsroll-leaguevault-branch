import { pgTable, text, serial, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";

// Fields covered by this audit. Email changes are intentionally NOT in
// this list — those go through a separate confirmation flow and live
// in `admin_email_change_audits` (see task #325). The values here map
// 1:1 to columns on `users` that the PATCH /api/account/profile/:id
// route can mutate synchronously.
export const ADMIN_PROFILE_EDIT_FIELDS = [
  "name",
  "phone",
  "preferred_language",
] as const;
export type AdminProfileEditField = (typeof ADMIN_PROFILE_EDIT_FIELDS)[number];

// Audit trail for `PATCH /api/account/profile/:id` when a system_admin
// edits *another* user's profile (task #376). One row per changed
// field per request, written in the SAME transaction as the user
// update so the audit and the change cannot disagree. Self-serve
// edits (`actorUserId === targetUserId`) do NOT write rows here —
// they are logged at INFO and are not an after-the-fact concern.
//
// `oldValue` / `newValue` are stored verbatim (nullable, since clearing
// a phone is a real edit). The table is admin-only readable; treat any
// new field that adds higher-sensitivity data with the same masking
// rule used in `admin_email_change_audits`.
export const adminProfileEditAudits = pgTable("admin_profile_edit_audits", {
  id: serial("id").primaryKey(),
  // The system admin who initiated the change. `restrict` so the audit
  // row survives a user-soft-delete; the FK guarantees the admin row
  // existed at the time of the action.
  actorUserId: integer("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  // The user whose profile field is being edited.
  targetUserId: integer("target_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  // Which column changed (see ADMIN_PROFILE_EDIT_FIELDS).
  field: text("field").notNull(),
  // Previous and new values. Nullable so that "clearing a phone" is
  // representable; this matches the tri-state semantics on the
  // PATCH route.
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("admin_profile_edit_audits_created_at_idx").on(table.createdAt),
  targetIdx: index("admin_profile_edit_audits_target_idx").on(table.targetUserId),
  actorIdx: index("admin_profile_edit_audits_actor_idx").on(table.actorUserId),
  // Defense in depth: the application-layer zod check on
  // `insertAdminProfileEditAuditSchema.field` is the primary guard,
  // but we mirror it as a DB CHECK so even a future call site that
  // bypasses the storage helper cannot land a garbage `field` value.
  // Keep this list in sync with ADMIN_PROFILE_EDIT_FIELDS.
  fieldCheck: check(
    "admin_profile_edit_audits_field_check",
    sql`${table.field} IN ('name', 'phone', 'preferred_language')`,
  ),
}));

export const insertAdminProfileEditAuditSchema = createInsertSchema(adminProfileEditAudits)
  .extend({
    actorUserId: z.number().int().positive(),
    targetUserId: z.number().int().positive(),
    field: z.enum(ADMIN_PROFILE_EDIT_FIELDS),
    oldValue: z.string().nullable(),
    newValue: z.string().nullable(),
  })
  .omit({ id: true, createdAt: true });

export type AdminProfileEditAudit = typeof adminProfileEditAudits.$inferSelect;
export type InsertAdminProfileEditAudit = z.infer<typeof insertAdminProfileEditAuditSchema>;
