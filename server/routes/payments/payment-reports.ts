/**
 * Payment reporting endpoints (mounted under /api/payments).
 *
 * Currently exposes the list/filter endpoint used to build payment reports
 * for bowlers, leagues, teams, and organizations.
 */
import { Router } from 'express';
import { storage } from '../../storage';
import { sendSuccess, sendError, sendPaginatedSuccess, parsePaginationParams } from '../../utils/api.js';
import { requireOrganizationAccess } from '../../utils/access-control.js';
import { createLogger } from '../../logger';

const log = createLogger("Payments");

const router = Router();

// Get payments with optional filters
router.get("/", async (req, res) => {
  try {
    const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
    const isSystemAdmin = req.user?.role === 'system_admin';
    const rawQueryOrgId = req.query.organizationId ? parseInt(req.query.organizationId as string) : undefined;
    if (rawQueryOrgId !== undefined && isNaN(rawQueryOrgId)) {
      return sendError(res, "Invalid organization ID format", 400);
    }
    // Effective org context: explicit param > sysadmin's own org > null (unaffiliated sysadmin)
    const effectiveOrgId: number | null = isSystemAdmin
      ? (rawQueryOrgId ?? req.user?.organizationId ?? null)
      : (req.user?.organizationId ?? null);

    if (leagueId) {
      const league = await storage.getLeague(leagueId);
      if (!league) {
        return sendError(res, "League not found", 404, 'NOT_FOUND');
      }
      if (!requireOrganizationAccess(req, league.organizationId, 'league', leagueId)) {
        return sendError(res, "You don't have access to this league's payments", 403, 'FORBIDDEN');
      }
    }

    if (!isSystemAdmin && effectiveOrgId === null) {
      return sendSuccess(res, []);
    }

    const baseFilters = {
      bowlerId: req.query.bowlerId ? parseInt(req.query.bowlerId as string) : undefined,
      leagueId,
      teamId: req.query.teamId ? parseInt(req.query.teamId as string) : undefined,
      weekOf: req.query.weekOf ? new Date(req.query.weekOf as string) : undefined,
    };

    const paginationParams = parsePaginationParams(req.query);

    if (isSystemAdmin && effectiveOrgId === null) {
      if (paginationParams) {
        const result = await storage.getAllPaymentsPaginatedSystemAdmin(baseFilters, paginationParams.page, paginationParams.limit);
        return sendPaginatedSuccess(res, result.items, result.pagination);
      }
      const payments = await storage.getAllPaymentsSystemAdmin(baseFilters);
      return sendSuccess(res, payments);
    }

    const filters = { ...baseFilters, organizationId: effectiveOrgId! };

    if (paginationParams) {
      const result = await storage.getPaymentsPaginated(filters, paginationParams.page, paginationParams.limit);
      return sendPaginatedSuccess(res, result.items, result.pagination);
    }

    const payments = await storage.getPayments(filters);

    sendSuccess(res, payments);
  } catch (error) {
    log.error('Get error:', error);
    sendError(res, 'Failed to fetch payments');
  }
});

export default router;
