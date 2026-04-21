import { sql, isNull, ne, and } from "drizzle-orm";
import { db } from "../db.js";
import {
  leagues,
  teams,
  bowlerLeagues,
  payments,
  users,
} from "@shared/schema";

export interface OrphanedDataCounts {
  leagues: number;
  teams: number;
  bowlerLeagues: number;
  payments: number;
  users: number;
}

/**
 * Count rows whose effective `organizationId` is NULL. Resources without a
 * direct `organizationId` column (teams, bowler_leagues, payments) inherit
 * the org of their parent league, so they are counted by joining to leagues
 * where `leagues.organization_id IS NULL` OR the parent league is missing.
 *
 * Users are counted as orphaned when they are NOT a `system_admin` (system
 * admins legitimately have no organization) and `organization_id IS NULL`.
 */
export async function countOrphanedRows(): Promise<OrphanedDataCounts> {
  const orphanLeaguesQ = db
    .select({ value: sql<number>`count(*)::int` })
    .from(leagues)
    .where(isNull(leagues.organizationId));

  const orphanTeamsQ = db
    .select({ value: sql<number>`count(*)::int` })
    .from(teams)
    .leftJoin(leagues, sql`${teams.leagueId} = ${leagues.id}`)
    .where(sql`${leagues.id} IS NULL OR ${leagues.organizationId} IS NULL`);

  const orphanBowlerLeaguesQ = db
    .select({ value: sql<number>`count(*)::int` })
    .from(bowlerLeagues)
    .leftJoin(leagues, sql`${bowlerLeagues.leagueId} = ${leagues.id}`)
    .where(sql`${leagues.id} IS NULL OR ${leagues.organizationId} IS NULL`);

  const orphanPaymentsQ = db
    .select({ value: sql<number>`count(*)::int` })
    .from(payments)
    .leftJoin(leagues, sql`${payments.leagueId} = ${leagues.id}`)
    .where(sql`${leagues.id} IS NULL OR ${leagues.organizationId} IS NULL`);

  const orphanUsersQ = db
    .select({ value: sql<number>`count(*)::int` })
    .from(users)
    .where(and(isNull(users.organizationId), ne(users.role, 'system_admin')));

  const [
    [leagueRow],
    [teamRow],
    [blRow],
    [payRow],
    [userRow],
  ] = await Promise.all([
    orphanLeaguesQ,
    orphanTeamsQ,
    orphanBowlerLeaguesQ,
    orphanPaymentsQ,
    orphanUsersQ,
  ]);

  return {
    leagues: Number(leagueRow?.value ?? 0),
    teams: Number(teamRow?.value ?? 0),
    bowlerLeagues: Number(blRow?.value ?? 0),
    payments: Number(payRow?.value ?? 0),
    users: Number(userRow?.value ?? 0),
  };
}
