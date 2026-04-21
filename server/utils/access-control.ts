import { Request } from 'express';
import { storage } from '../storage';
import { createLogger } from '../logger';

const log = createLogger("AccessControl");

/**
 * Org-less resource policy
 * ------------------------
 * Resources with `organizationId === null` are treated as orphaned data — they
 * are usually the result of a bug or stale data. We deny access to them for
 * EVERY role, including `system_admin`, regardless of the surrounding context.
 *
 * If a system admin needs to inspect or repair orphaned rows, they must do so
 * through an explicit "orphaned data" admin tool (see
 * `GET /api/system-admin/orphaned-data-counts` and any future repair endpoints
 * built on top of it). The general-purpose CRUD/read paths must never expose
 * org-less rows. This keeps PII contained and surfaces data-integrity bugs
 * instead of silently absorbing them.
 */

export function isSystemAdmin(user: Express.User | undefined): boolean {
  return user?.role === 'system_admin';
}

export function isOrgOrHigher(user: Express.User | undefined): boolean {
  return user?.role === 'org_admin' || user?.role === 'system_admin';
}

export function requireOrganizationAccess(req: Request, resourceOrgId: number | null, resourceType?: string, resourceId?: number | string): boolean {
  if (!req.user) return false;
  if (resourceOrgId === null) {
    log.warn(`${resourceType ?? 'resource'} ${resourceId ?? '?'} has no organization — denying access to user ${req.user.id} (role=${req.user.role})`);
    return false;
  }
  if (isSystemAdmin(req.user)) return true;
  return req.user.organizationId === resourceOrgId;
}

export async function hasAccessToLeague(req: Request, leagueId: number): Promise<boolean> {
  if (!req.user) {
    return false;
  }

  const league = await storage.getLeague(leagueId);
  if (!league) {
    return false;
  }

  if (league.organizationId === null) {
    log.warn(`league ${leagueId} has no organization — denying access to user ${req.user.id} (role=${req.user.role})`);
    return false;
  }

  if (isSystemAdmin(req.user)) {
    return true;
  }

  if (req.user.bowlerId) {
    const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId: req.user.bowlerId });
    if (bowlerLeagues.some((bl) => bl.leagueId === leagueId)) {
      return true;
    }
  }

  if (!req.user.organizationId) {
    return false;
  }

  return req.user.organizationId === league.organizationId;
}

export async function hasAccessToTeam(req: Request, teamId: number): Promise<boolean> {
  if (!req.user) {
    return false;
  }

  const team = await storage.getTeam(teamId);
  if (!team) {
    return false;
  }

  return hasAccessToLeague(req, team.leagueId);
}

/**
 * Single-bowler access check. Use this only for endpoints that gate on a
 * single bowler ID. For any endpoint that operates on a list of bowler IDs
 * (request body or query), call `hasAccessToBowlers(req, bowlerIds)` instead
 * of looping this helper — looping causes N×3 query amplification, while the
 * batched helper does a constant number of storage reads regardless of input
 * size and matches the same access semantics exactly.
 */
export async function hasAccessToBowler(req: Request, bowlerId: number): Promise<boolean> {
  if (!req.user) {
    return false;
  }

  // Self-access shortcut: a user may always read their own linked bowler
  // record, even if every league assignment is currently org-less. This is
  // an intentional, narrowly scoped exception to the org-less deny rule so
  // bowlers are never locked out of their own profile.
  if (req.user.bowlerId === bowlerId) {
    return true;
  }

  const bowlerLeagueEntries = await storage.getBowlerLeagues({ bowlerId });

  if (bowlerLeagueEntries.length === 0) {
    return false;
  }

  const leagueIds = [...new Set(bowlerLeagueEntries.map(bl => bl.leagueId))];
  const fetchedLeagues = await storage.getLeaguesByIds(leagueIds);

  let userLeagueIds: number[] = [];
  if (req.user.bowlerId) {
    const userBowlerLeagues = await storage.getBowlerLeagues({ bowlerId: req.user.bowlerId });
    userLeagueIds = userBowlerLeagues.map(bl => bl.leagueId);
  }

  const userIsSystemAdmin = isSystemAdmin(req.user);

  for (const league of fetchedLeagues) {
    if (req.user.bowlerId && userLeagueIds.includes(league.id)) {
      return true;
    }
    if (league.organizationId === null) {
      log.warn(`bowler ${bowlerId} via league ${league.id} has no organization — denying access to user ${req.user.id} (role=${req.user.role})`);
      continue;
    }
    if (userIsSystemAdmin) {
      return true;
    }
    if (req.user.organizationId && req.user.organizationId === league.organizationId) {
      return true;
    }
  }

  return false;
}

/**
 * Batched access check: returns a Map<bowlerId, boolean> indicating whether
 * the requesting user may access each bowler. Uses a constant number of
 * storage reads (at most one batched bowler-leagues lookup and one batched
 * leagues lookup) regardless of how many bowler IDs are passed in. This is
 * the amplification-safe replacement for looping `hasAccessToBowler` over
 * an array.
 *
 * Semantics match `hasAccessToBowler` exactly:
 *  - Unauthenticated → all denied.
 *  - Self-access shortcut for `req.user.bowlerId`.
 *  - Bowlers with no league entries → denied for everyone (incl. system admin).
 *  - Org-less leagues are skipped (and warn-logged) for every role.
 *  - System admins are allowed via any non-org-less league entry.
 *  - Org users are allowed when their org matches a league's organizationId.
 *  - Users sharing a league with the target bowler are allowed.
 *
 * Duplicate IDs are de-duplicated; the returned map is keyed by the unique
 * input IDs. Empty input returns an empty map.
 */
export async function hasAccessToBowlers(
  req: Request,
  bowlerIds: number[],
): Promise<Map<number, boolean>> {
  const result = new Map<number, boolean>();
  const uniqueIds = [...new Set(bowlerIds)];

  if (uniqueIds.length === 0) {
    return result;
  }

  for (const id of uniqueIds) {
    result.set(id, false);
  }

  if (!req.user) {
    return result;
  }

  const userBowlerId = req.user.bowlerId ?? null;

  // Self-access shortcut: a user may always access their own linked bowler
  // record, even if every league assignment is currently org-less.
  const idsToCheck = new Set<number>();
  for (const id of uniqueIds) {
    if (userBowlerId !== null && id === userBowlerId) {
      result.set(id, true);
    } else {
      idsToCheck.add(id);
    }
  }

  if (idsToCheck.size === 0) {
    return result;
  }

  // Fold the requesting user's own bowlerId into the same batched lookup so
  // we can compute their league memberships in the same DB round-trip.
  const lookupIds = new Set<number>(idsToCheck);
  if (userBowlerId !== null) {
    lookupIds.add(userBowlerId);
  }

  const allBowlerLeagueEntries = await storage.getBowlerLeaguesByBowlerIds([...lookupIds]);

  const userLeagueIds = new Set<number>();
  const leagueIdsByBowler = new Map<number, number[]>();
  for (const entry of allBowlerLeagueEntries) {
    if (userBowlerId !== null && entry.bowlerId === userBowlerId) {
      userLeagueIds.add(entry.leagueId);
    }
    if (idsToCheck.has(entry.bowlerId)) {
      const list = leagueIdsByBowler.get(entry.bowlerId);
      if (list) {
        list.push(entry.leagueId);
      } else {
        leagueIdsByBowler.set(entry.bowlerId, [entry.leagueId]);
      }
    }
  }

  const allLeagueIds = new Set<number>(userLeagueIds);
  for (const list of leagueIdsByBowler.values()) {
    for (const id of list) allLeagueIds.add(id);
  }

  if (allLeagueIds.size === 0) {
    return result;
  }

  const fetchedLeagues = await storage.getLeaguesByIds([...allLeagueIds]);
  const leagueMap = new Map(fetchedLeagues.map(l => [l.id, l]));

  const userIsSystemAdmin = isSystemAdmin(req.user);
  const userOrgId = req.user.organizationId ?? null;

  for (const bowlerId of idsToCheck) {
    const bowlerLeagueIds = leagueIdsByBowler.get(bowlerId);
    if (!bowlerLeagueIds || bowlerLeagueIds.length === 0) {
      continue;
    }

    let allowed = false;
    for (const leagueId of bowlerLeagueIds) {
      const league = leagueMap.get(leagueId);
      if (!league) continue;

      if (userBowlerId !== null && userLeagueIds.has(league.id)) {
        allowed = true;
        break;
      }
      if (league.organizationId === null) {
        log.warn(`bowler ${bowlerId} via league ${league.id} has no organization — denying access to user ${req.user.id} (role=${req.user.role})`);
        continue;
      }
      if (userIsSystemAdmin) {
        allowed = true;
        break;
      }
      if (userOrgId !== null && userOrgId === league.organizationId) {
        allowed = true;
        break;
      }
    }

    result.set(bowlerId, allowed);
  }

  return result;
}

export async function hasAccessToPayment(req: Request, paymentId: number): Promise<boolean> {
  if (!req.user) {
    return false;
  }

  try {
    const payment = await storage.getPaymentById(paymentId);
    if (!payment) {
      return false;
    }

    const league = await storage.getLeague(payment.leagueId);
    if (!league) {
      return false;
    }

    if (league.organizationId === null) {
      log.warn(`payment ${paymentId} via league ${payment.leagueId} has no organization — denying access to user ${req.user.id} (role=${req.user.role})`);
      return false;
    }

    if (isSystemAdmin(req.user)) {
      return true;
    }

    if (!req.user.organizationId) {
      return false;
    }

    return req.user.organizationId === league.organizationId;
  } catch (error) {
    log.error(`Error checking payment access:`, error);
    return false;
  }
}

export async function filterPaymentsByOrganization(req: Request, payments: { leagueId: number }[]): Promise<{ leagueId: number }[]> {
  if (!req.user) {
    return [];
  }

  // Resolve which leagueIds in the input set belong to a real organization.
  // Per the org-less resource policy, payments whose parent league is missing
  // or has organization_id IS NULL are excluded for every role, including
  // system_admin.
  const referencedLeagueIds = [...new Set(payments.map(p => p.leagueId))];
  const fetchedLeagues = referencedLeagueIds.length === 0
    ? []
    : await storage.getLeaguesByIds(referencedLeagueIds);
  const orgScopedLeagueIds = new Set(
    fetchedLeagues.filter(l => l.organizationId !== null).map(l => l.id),
  );

  if (isSystemAdmin(req.user)) {
    return payments.filter(p => orgScopedLeagueIds.has(p.leagueId));
  }

  if (!req.user.organizationId) {
    return [];
  }

  const userOrgId = req.user.organizationId;
  const userOrgLeagueIds = new Set(
    fetchedLeagues
      .filter(l => l.organizationId === userOrgId)
      .map(l => l.id),
  );
  return payments.filter(p => orgScopedLeagueIds.has(p.leagueId) && userOrgLeagueIds.has(p.leagueId));
}
