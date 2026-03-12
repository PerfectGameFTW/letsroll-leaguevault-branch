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

  const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId });

  if (bowlerLeagues.length === 0) {
    return !!req.user;
  }

  for (const bl of bowlerLeagues) {
    if (await hasAccessToLeague(req, bl.leagueId)) {
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
    const payments = await storage.getPayments(undefined, undefined, undefined, undefined);
    const payment = payments.find(p => p.id === paymentId);
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
