/**
 * Shared helpers and middleware used by every payments-provider sub-router.
 */
import type { Request, Response, NextFunction } from 'express';
import { storage } from '../../storage';
import { sendError } from '../../utils/api.js';
import { getPaymentProvider } from '../../services/payment-provider-factory';

export async function getProviderForLeague(leagueId: number) {
  const league = await storage.getLeague(leagueId);
  const locationId = league?.locationId ?? null;
  return getPaymentProvider(locationId);
}

export function requireAuthenticated(req: Request, res: Response, next: NextFunction) {
  const r = req as Request & { isAuthenticated?: () => boolean };
  if (!r.isAuthenticated || !r.isAuthenticated()) {
    return sendError(res, 'Authentication required', 401, 'UNAUTHORIZED');
  }
  next();
}
