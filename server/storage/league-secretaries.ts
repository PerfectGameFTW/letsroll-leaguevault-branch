import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db.js";
import {
  leagueSecretaries,
  leagueSecretaryAudits,
  leagues,
  users,
  type LeagueSecretary,
  type InsertLeagueSecretary,
  type LeagueSecretaryAudit,
  type InsertLeagueSecretaryAudit,
} from "@shared/schema";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Insert a (user, league) secretary grant. The DB-level invariant in
 * `server/db-invariants.ts` rejects rows whose `organization_id` does
 * not match the parent league's `organization_id`, so a tampered insert
 * cannot grant cross-tenant powers even if it bypasses the route layer.
 */
export async function createLeagueSecretary(
  values: InsertLeagueSecretary,
  executor: DbExecutor = db,
): Promise<LeagueSecretary> {
  const [row] = await executor.insert(leagueSecretaries).values(values).returning();
  return row;
}

export async function deleteLeagueSecretary(
  userId: number,
  leagueId: number,
  executor: DbExecutor = db,
): Promise<boolean> {
  const result = await executor
    .delete(leagueSecretaries)
    .where(
      and(eq(leagueSecretaries.userId, userId), eq(leagueSecretaries.leagueId, leagueId)),
    )
    .returning({ id: leagueSecretaries.id });
  return result.length > 0;
}

export async function getLeagueSecretary(
  userId: number,
  leagueId: number,
): Promise<LeagueSecretary | undefined> {
  const [row] = await db
    .select()
    .from(leagueSecretaries)
    .where(
      and(eq(leagueSecretaries.userId, userId), eq(leagueSecretaries.leagueId, leagueId)),
    );
  return row;
}

export async function isLeagueSecretary(
  userId: number,
  leagueId: number,
): Promise<boolean> {
  const row = await getLeagueSecretary(userId, leagueId);
  return !!row;
}

/**
 * Returns every league id the given user has been granted secretary on.
 * Used by access-control fan-out filters and the secretary "My Leagues"
 * landing page.
 */
export async function getSecretaryLeagueIdsForUser(userId: number): Promise<number[]> {
  const rows = await db
    .select({ leagueId: leagueSecretaries.leagueId })
    .from(leagueSecretaries)
    .where(eq(leagueSecretaries.userId, userId));
  return rows.map((r) => r.leagueId);
}

/**
 * List the secretary roster for a single league. Joined with `users` so
 * the org-admin UI can render name/email without a second round-trip.
 */
export async function listSecretariesForLeague(
  leagueId: number,
): Promise<
  Array<{
    id: number;
    userId: number;
    leagueId: number;
    organizationId: number;
    grantedAt: string;
    grantedByUserId: number;
    user: { id: number; name: string; email: string } | null;
  }>
> {
  const rows = await db
    .select({
      id: leagueSecretaries.id,
      userId: leagueSecretaries.userId,
      leagueId: leagueSecretaries.leagueId,
      organizationId: leagueSecretaries.organizationId,
      grantedAt: leagueSecretaries.grantedAt,
      grantedByUserId: leagueSecretaries.grantedByUserId,
      userIdJoin: users.id,
      userName: users.name,
      userEmail: users.email,
    })
    .from(leagueSecretaries)
    .innerJoin(leagues, eq(leagues.id, leagueSecretaries.leagueId))
    .leftJoin(users, eq(users.id, leagueSecretaries.userId))
    .where(
      and(
        eq(leagueSecretaries.leagueId, leagueId),
        // Defence in depth: if a league was reassigned to another org
        // after grants were issued, the stamped grant.org_id can drift
        // from the league's current org_id. Hide stale rows from the
        // new org's admin so a cross-tenant disclosure is impossible
        // even if the cleanup trigger missed a row.
        eq(leagueSecretaries.organizationId, leagues.organizationId),
      ),
    )
    .orderBy(leagueSecretaries.grantedAt);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    leagueId: r.leagueId,
    organizationId: r.organizationId,
    grantedAt: r.grantedAt,
    grantedByUserId: r.grantedByUserId,
    user: r.userIdJoin
      ? { id: r.userIdJoin, name: r.userName ?? "", email: r.userEmail ?? "" }
      : null,
  }));
}

/**
 * Returns true iff `userId` is currently a secretary of any league
 * belonging to `organizationId`. Used by the org-admin UI to badge the
 * user list and by the org-isolation guard when listing secretaries.
 */
export async function userHasAnySecretaryRoleInOrg(
  userId: number,
  organizationId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: leagueSecretaries.id })
    .from(leagueSecretaries)
    .where(
      and(
        eq(leagueSecretaries.userId, userId),
        eq(leagueSecretaries.organizationId, organizationId),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Returns the subset of `leagueIds` for which `userId` is currently a
 * secretary. Constant-round-trip helper for batched filters in
 * route handlers (e.g. "filter the leagues list to ones I admin").
 */
export async function getSecretaryLeagueIdsAmong(
  userId: number,
  leagueIds: number[],
): Promise<Set<number>> {
  if (leagueIds.length === 0) return new Set();
  const rows = await db
    .select({ leagueId: leagueSecretaries.leagueId })
    .from(leagueSecretaries)
    .where(
      and(
        eq(leagueSecretaries.userId, userId),
        inArray(leagueSecretaries.leagueId, leagueIds),
      ),
    );
  return new Set(rows.map((r) => r.leagueId));
}

export async function recordLeagueSecretaryAudit(
  values: InsertLeagueSecretaryAudit,
  executor: DbExecutor = db,
): Promise<LeagueSecretaryAudit> {
  const [row] = await executor.insert(leagueSecretaryAudits).values(values).returning();
  return row;
}

/**
 * Resolve a league's owning organization id without going through the
 * cached `storage.getLeague`. Used by the grant route to authoritatively
 * read the org id at write time so the grant cannot race a `updateLeague`
 * that points the row at a different org.
 */
export async function getLeagueOrgIdDirect(leagueId: number): Promise<number | null | undefined> {
  const [row] = await db
    .select({ organizationId: leagues.organizationId })
    .from(leagues)
    .where(eq(leagues.id, leagueId));
  return row ? row.organizationId : undefined;
}
