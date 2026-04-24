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

/**
 * Parse an optional integer query-string parameter.
 *
 * Returns `undefined` when the param is missing (the route's "no
 * filter" sentinel) and `null` when the caller sent something we
 * couldn't make sense of — the route maps `null` to a 400.
 *
 * The validation is intentionally STRICT (digits with an optional
 * leading minus, nothing else): the previous `parseInt` + `isNaN`
 * pattern silently accepted partially-numeric input like
 * `?leagueId=42abc` as `42`, which doesn't match the task #406
 * intent of "reject malformed numeric filters". A bare `?x=` is
 * still treated as "no filter" so existing UIs that submit cleared
 * form inputs are not broken (regression-pinned in the test file).
 */
function parseOptionalIntParam(raw: unknown): number | undefined | null {
  if (raw === undefined) return undefined;
  // Express normalizes single-occurrence query params to strings;
  // anything else (array, object) is malformed by definition.
  if (typeof raw !== 'string') return null;
  if (raw === '') return undefined;
  // Strict: optional sign + digits only — no decimals, no trailing
  // letters. This is a small tightening over the pre-existing
  // organization-id check, in the same spirit.
  if (!/^-?\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an optional date query-string parameter.
 *
 * Same tri-state contract as `parseOptionalIntParam`:
 * `undefined` = not provided, `null` = unparseable (→ 400), Date =
 * good. `new Date('garbage')` returns an Invalid Date silently, so
 * the route used to forward those straight into the storage layer
 * and trip a confusing 500.
 */
function parseOptionalDateParam(raw: unknown): Date | undefined | null {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return null;
  if (raw === '') return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Get payments with optional filters
router.get("/", async (req, res) => {
  try {
    // task #406: validate every numeric/date filter up front instead
    // of forwarding NaN / Invalid Date into the storage layer (which
    // produced confusing 500s and noisy logs). Each param is
    // independently checked so the 400 message tells the caller
    // exactly which one was malformed.
    const isSystemAdmin = req.user?.role === 'system_admin';

    const rawQueryOrgId = parseOptionalIntParam(req.query.organizationId);
    if (rawQueryOrgId === null) {
      return sendError(res, "Invalid organization ID format", 400);
    }
    const leagueId = parseOptionalIntParam(req.query.leagueId);
    if (leagueId === null) {
      return sendError(res, "Invalid league ID format", 400);
    }
    const bowlerId = parseOptionalIntParam(req.query.bowlerId);
    if (bowlerId === null) {
      return sendError(res, "Invalid bowler ID format", 400);
    }
    const teamId = parseOptionalIntParam(req.query.teamId);
    if (teamId === null) {
      return sendError(res, "Invalid team ID format", 400);
    }
    const weekOf = parseOptionalDateParam(req.query.weekOf);
    if (weekOf === null) {
      return sendError(res, "Invalid weekOf date format", 400);
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
      bowlerId,
      leagueId,
      teamId,
      weekOf,
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
