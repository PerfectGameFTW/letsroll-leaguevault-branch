import {
  pgTable,
  serial,
  integer,
  timestamp,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { leagues } from "./leagues";
import { organizations } from "./organizations";

/**
 * Per-league admin grant — Task #735.
 *
 * League Secretary is NOT a `users.role` value. It is a per-(user, league)
 * grant in this join table, intentionally decoupled from the global role
 * system so that a single user can be a Secretary of one league without
 * being elevated to `org_admin` for the entire organization.
 *
 * Grant policy (enforced in routes, not schema):
 *   - Only `org_admin` of the league's owning org may grant or revoke.
 *   - `system_admin` is explicitly REJECTED from grant/revoke — secretary
 *     management is the org's responsibility, not the platform's.
 *
 * Powers (enforced via `hasAdminAccessToLeague` / `hasSecretaryAccessToBowler`
 * in `server/utils/access-control.ts`):
 *   - Full league admin within the granted league: roster, teams, scores,
 *     refunds, recording cash/check payments.
 *   - CANNOT see saved cards or payment provider customer ids.
 *   - CANNOT delete the league.
 *   - CANNOT modify the league's location or payment provider settings.
 *   - CANNOT see other leagues' or org-level data.
 *
 * The `organizationId` column is denormalised from `leagues.organizationId`
 * so the row can be filtered/joined without a leagues lookup, and so the
 * boot-time invariant in `server/db-invariants.ts` can enforce that the
 * stored org_id always matches the league's org_id at write time (a
 * tampered insert that points at a sibling league would otherwise grant
 * cross-tenant powers).
 */
export const leagueSecretaries = pgTable(
  "league_secretaries",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    grantedByUserId: integer("granted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("league_secretaries_user_idx").on(table.userId),
    leagueIdx: index("league_secretaries_league_idx").on(table.leagueId),
    orgIdx: index("league_secretaries_org_idx").on(table.organizationId),
    uniqueUserLeague: uniqueIndex("league_secretaries_user_league_uniq").on(
      table.userId,
      table.leagueId,
    ),
  }),
);

export const insertLeagueSecretarySchema = createInsertSchema(leagueSecretaries)
  .extend({
    userId: z.number().int().positive(),
    leagueId: z.number().int().positive(),
    organizationId: z.number().int().positive(),
    grantedByUserId: z.number().int().positive(),
  })
  .omit({ id: true, grantedAt: true });

export type LeagueSecretary = typeof leagueSecretaries.$inferSelect;
export type InsertLeagueSecretary = z.infer<typeof insertLeagueSecretarySchema>;

/**
 * Per-grant audit row. Captures both grants and revokes so a deleted
 * row does not lose its history. Mirrors the pattern in
 * `shared/schema/admin-role-change-audits.ts`.
 */
export const LEAGUE_SECRETARY_ACTIONS = ["grant", "revoke"] as const;
export type LeagueSecretaryAction = (typeof LEAGUE_SECRETARY_ACTIONS)[number];

export const leagueSecretaryAudits = pgTable(
  "league_secretary_audits",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    targetUserId: integer("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "restrict" }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    action: text("action", { enum: LEAGUE_SECRETARY_ACTIONS }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    createdAtIdx: index("league_secretary_audits_created_at_idx").on(table.createdAt),
    leagueIdx: index("league_secretary_audits_league_idx").on(table.leagueId),
    targetIdx: index("league_secretary_audits_target_idx").on(table.targetUserId),
    actorIdx: index("league_secretary_audits_actor_idx").on(table.actorUserId),
  }),
);

export const insertLeagueSecretaryAuditSchema = createInsertSchema(leagueSecretaryAudits)
  .extend({
    actorUserId: z.number().int().positive(),
    targetUserId: z.number().int().positive(),
    leagueId: z.number().int().positive(),
    organizationId: z.number().int().positive(),
    action: z.enum(LEAGUE_SECRETARY_ACTIONS),
    ipAddress: z.string().max(64).nullable(),
    userAgent: z.string().max(512).nullable(),
  })
  .omit({ id: true, createdAt: true });

export type LeagueSecretaryAudit = typeof leagueSecretaryAudits.$inferSelect;
export type InsertLeagueSecretaryAudit = z.infer<typeof insertLeagueSecretaryAuditSchema>;
