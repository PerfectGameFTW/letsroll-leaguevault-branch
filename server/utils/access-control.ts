import { storage } from '../storage.js';

export async function hasAccessToLeague(req: any, leagueId: number): Promise<boolean> {
  if (!req.user) {
    return false;
  }

  if (req.user.isAdmin) {
    return true;
  }

  const league = await storage.getLeague(leagueId);
  if (!league) {
    return false;
  }

  if (req.user.bowlerId) {
    const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId: req.user.bowlerId });
    if (bowlerLeagues.some((bl: any) => bl.leagueId === leagueId)) {
      return true;
    }
  }

  if (league.organizationId === null) {
    return !!req.user;
  }

  if (!req.user.organizationId) {
    return false;
  }

  return req.user.organizationId === league.organizationId;
}

export async function hasAccessToTeam(req: any, teamId: number): Promise<boolean> {
  if (!req.user) {
    return false;
  }

  if (req.user.isAdmin) {
    return true;
  }

  const team = await storage.getTeam(teamId);
  if (!team) {
    return false;
  }

  return hasAccessToLeague(req, team.leagueId);
}

export async function hasAccessToBowler(req: any, bowlerId: number): Promise<boolean> {
  if (!req.user) {
    return false;
  }

  if (req.user.isAdmin) {
    return true;
  }

  if (req.user.bowlerId === bowlerId) {
    return true;
  }

  const bowlerLeagueEntries = await storage.getBowlerLeagues({ bowlerId });

  if (bowlerLeagueEntries.length === 0) {
    return req.user.isOrganizationAdmin || false;
  }

  const leagueIds = [...new Set(bowlerLeagueEntries.map(bl => bl.leagueId))];
  const fetchedLeagues = await storage.getLeaguesByIds(leagueIds);

  let userLeagueIds: number[] = [];
  if (req.user.bowlerId) {
    const userBowlerLeagues = await storage.getBowlerLeagues({ bowlerId: req.user.bowlerId });
    userLeagueIds = userBowlerLeagues.map(bl => bl.leagueId);
  }

  for (const league of fetchedLeagues) {
    if (req.user.bowlerId && userLeagueIds.includes(league.id)) {
      return true;
    }
    if (league.organizationId === null) {
      return true;
    }
    if (req.user.organizationId && req.user.organizationId === league.organizationId) {
      return true;
    }
  }

  return false;
}

export async function hasAccessToPayment(req: any, paymentId: number): Promise<boolean> {
  if (!req.user) {
    return false;
  }

  if (req.user.isAdmin) {
    return true;
  }

  if (!req.user.organizationId) {
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
      return true;
    }

    return req.user.organizationId === league.organizationId;
  } catch (error) {
    console.error(`[AccessControl] Error checking payment access:`, error);
    return false;
  }
}

export async function filterPaymentsByOrganization(req: any, payments: any[]): Promise<any[]> {
  if (!req.user) {
    return [];
  }

  if (req.user.isAdmin) {
    return payments;
  }

  if (!req.user.organizationId) {
    const leagues = await storage.getLeagues(null);
    if (!leagues || leagues.length === 0) {
      return [];
    }

    const leagueIds = leagues.map(l => l.id);
    return payments.filter(payment => leagueIds.includes(payment.leagueId));
  }

  const leagues = await storage.getLeagues(req.user.organizationId);
  if (!leagues || leagues.length === 0) {
    return [];
  }

  const leagueIds = leagues.map(l => l.id);
  return payments.filter(payment => leagueIds.includes(payment.leagueId));
}
