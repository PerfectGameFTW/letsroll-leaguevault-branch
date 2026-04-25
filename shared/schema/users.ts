import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { USER_ROLES, userRoleEnum, nameSchema, emailSchema } from "./constants";
import { passwordSchema } from "../password-validation";
import { bowlers } from "./bowlers";
import { organizations } from "./organizations";
import { locations } from "./locations";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  bowlerId: integer("bowler_id").references(() => bowlers.id),
  name: text("name").notNull(),
  phone: text("phone"),
  avatar: text("avatar"),
  role: userRoleEnum('role').notNull().default('user'),
  organizationId: integer("organization_id").references(() => organizations.id),
  locationId: integer("location_id").references(() => locations.id),
  inviteToken: text("invite_token"),
  inviteTokenExpiry: timestamp("invite_token_expiry", { mode: "string" }),
  // Two-letter ISO 639-1 code (e.g. 'en', 'es') used to localize
  // user-facing notifications (security emails, etc.). Nullable; the
  // email helpers fall back to English when this is null/unset/
  // unknown. See `server/services/email-i18n/` for supported locales.
  preferredLanguage: text("preferred_language"),
  // Task #357: hard lockout on /api/account/change-password after
  // repeated failed current-password checks. The per-user rate limiter
  // (#317, #356) still slows brute-forcing to ~10/15min, but a patient
  // attacker on a hijacked session can spread guesses across rate-limit
  // windows and still grind through ~960/day. This counter escalates
  // throttling to a temporary lockout once `failedPasswordChangeAttempts`
  // crosses `PASSWORD_CHANGE_LOCKOUT_THRESHOLD` (see server/storage/users.ts).
  // The counter is incremented atomically (FOR UPDATE) on every
  // INVALID_PASSWORD and reset to 0 on a successful change-password.
  // When the lock engages, every session for the user is destroyed and
  // an alert email is sent. The counter resets to 0 on the first new
  // failed attempt AFTER the lock has expired so a returning user gets
  // a fresh window instead of being re-locked on the very next typo.
  failedPasswordChangeAttempts: integer("failed_password_change_attempts").notNull().default(0),
  // When non-null and in the future, the user is locked out of the
  // change-password endpoint until this timestamp. The route checks
  // this BEFORE comparing the current password and returns 423
  // ACCOUNT_LOCKED so the client can prompt the user to use the
  // forgot-password flow. Naturally clears on success and on the
  // next failed attempt past expiry.
  passwordChangeLockedUntil: timestamp("password_change_locked_until", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  organizationIdx: index("users_organization_idx").on(table.organizationId),
  bowlerIdx: index("users_bowler_idx").on(table.bowlerId),
  locationIdx: index("users_location_idx").on(table.locationId),
  // The role/org invariant — every non-admin user must be attached to
  // an organization — is enforced by a DB-side TRIGGER named
  // `users_role_org_required`, installed idempotently by
  // `installDbInvariants` in `server/db-invariants.ts` (called from
  // both `server/index.ts` on every server boot and
  // `tests/setup/global-setup.ts` from vitest's globalSetup).
  // It used to be a CHECK constraint, but a trigger is required so
  // the system-admin "orphan data" cleanup tooling tests can stage
  // legacy org-less rows by briefly disabling the trigger inside a
  // single transaction (`ALTER TABLE ... DISABLE TRIGGER` only takes
  // SHARE ROW EXCLUSIVE — CHECK constraints can't be bypassed
  // per-session at all without superuser privileges).
}));


const baseUserSchema = createInsertSchema(users);

const requireOrgForNonAdmin = (
  data: { role?: string | null; organizationId?: number | null },
  ctx: z.RefinementCtx,
) => {
  const role = data.role ?? 'user';
  if (role !== 'system_admin' && (data.organizationId === null || data.organizationId === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['organizationId'],
      message: 'organizationId is required for non-admin users',
    });
  }
};

export const insertUserSchema = baseUserSchema.extend({
  email: emailSchema,
  name: nameSchema,
  phone: z.string().optional(),
  role: z.enum(USER_ROLES).optional().default('user'),
  organizationId: z.number().nullable().optional(),
  password: passwordSchema,
  bowlerId: z.number().nullable().optional(),
}).omit({ id: true, createdAt: true }).superRefine(requireOrgForNonAdmin);

// Base object schema (kept .pick / .omit / .partial friendly so that
// callers like `server/routes/account.ts` can derive narrower schemas).
export const updateUserSchemaBase = z.object({
  email: emailSchema,
  name: nameSchema,
  phone: z.string().nullable(),
  avatar: z.string().nullable(),
  role: z.enum(USER_ROLES),
  organizationId: z.number().nullable(),
  locationId: z.number().nullable(),
  bowlerId: z.number().nullable(),
  password: passwordSchema,
  preferredLanguage: z.string().nullable(),
}).partial();

// Strict update schema: refuses payloads that would set a non-admin
// user to an org-less state. The role/org invariant is also enforced
// at the storage layer (`setUserOrganization`, `updateUserRole`) and
// by the `users_role_org_required` DB CHECK constraint.
export const updateUserSchema = updateUserSchemaBase.superRefine((data, ctx) => {
  const settingNullOrg = data.organizationId === null;
  const settingNonAdminRole = data.role !== undefined && data.role !== 'system_admin';
  if (settingNullOrg && settingNonAdminRole) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['organizationId'],
      message: 'organizationId is required for non-admin users',
    });
  }
  if (settingNullOrg && data.role === undefined) {
    // We can't know the resulting role here without the DB row, so leave
    // this case to the storage-layer guard which has the existing role.
  }
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
