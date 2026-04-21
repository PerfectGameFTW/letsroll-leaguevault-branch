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
