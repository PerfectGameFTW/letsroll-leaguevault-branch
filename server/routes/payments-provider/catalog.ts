/**
 * Catalog reads for providers that support them (e.g. Square).
 *
 * Routes:
 *  - GET /catalog/categories
 *  - GET /catalog/items
 */
import { Router } from 'express';
import { storage } from '../../storage';
import { sendSuccess, sendError, parseOptionalIntParam } from '../../utils/api.js';
import { createLogger } from '../../logger';
import { getPaymentProvider, ProviderNotConfiguredError } from '../../services/payment-provider-factory';
import { hasCatalogSupport } from '../../services/payment-provider';

const log = createLogger('Payments');

const router = Router();

router.get('/catalog/categories', async (req, res) => {
  try {
    // task #421: tighten the `?locationId` filter. The previous
    // `parseInt` + `!isNaN` ternary had a real security smell: when
    // the caller sent something unparseable like `?locationId=foo`,
    // `lvLocationId` was NaN, the `!isNaN` guard skipped the org
    // ownership check ENTIRELY, and the request fell through to
    // `getPaymentProvider(NaN)` (which then 404'd on the provider
    // lookup). Rejecting up front closes that bypass and gives the
    // caller a clear error message.
    const parsedLocationId = parseOptionalIntParam(req.query.locationId);
    if (parsedLocationId === null) {
      return sendError(res, 'Invalid location ID format', 400);
    }
    // Preserve the prior truthy semantics for `?locationId=0` (treated
    // as "no filter" — 0 is not a valid serial id) so this change is
    // strictly a malformed-input tightening.
    const lvLocationId: number | null = parsedLocationId ?? null;

    if (lvLocationId) {
      const loc = await storage.getLocation(lvLocationId);
      if (!loc) return sendError(res, 'Location not found', 404, 'NOT_FOUND');
      const isAuthorized =
        req.user?.role === 'system_admin' ||
        (req.user?.organizationId != null && req.user.organizationId === loc.organizationId);
      if (!isAuthorized) return sendError(res, 'Forbidden', 403, 'FORBIDDEN');
    }

    let provider;
    try {
      provider = await getPaymentProvider(lvLocationId);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        log.warn('Catalog categories: provider not configured, returning empty', { locationId: lvLocationId });
        return sendSuccess(res, { categories: [], truncated: false });
      }
      throw e;
    }
    if (!hasCatalogSupport(provider)) {
      return sendSuccess(res, { categories: [], truncated: false });
    }

    // Task #623: forward the provider's `truncated` flag so the admin
    // UI can show a banner explaining that the safety cap fired and
    // the visible list is incomplete (rather than pretending the
    // capped list is the whole catalog, as pre-#623 did).
    const result = await provider.listCatalogCategories();
    sendSuccess(res, result);
  } catch (error) {
    log.error('Catalog categories error:', error);
    sendError(res, 'Failed to fetch catalog categories');
  }
});

router.get('/catalog/items', async (req, res) => {
  try {
    const categoryId = req.query.categoryId as string | undefined;
    const parsedLocationId = parseOptionalIntParam(req.query.locationId);
    if (parsedLocationId === null) {
      return sendError(res, 'Invalid location ID format', 400);
    }
    const lvLocationId: number | null = parsedLocationId ?? null;

    if (lvLocationId) {
      const loc = await storage.getLocation(lvLocationId);
      if (!loc) return sendError(res, 'Location not found', 404, 'NOT_FOUND');
      const isAuthorized =
        req.user?.role === 'system_admin' ||
        (req.user?.organizationId != null && req.user.organizationId === loc.organizationId);
      if (!isAuthorized) return sendError(res, 'Forbidden', 403, 'FORBIDDEN');
    }

    let provider;
    try {
      provider = await getPaymentProvider(lvLocationId);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        log.warn('Catalog items: provider not configured, returning empty', { locationId: lvLocationId });
        return sendSuccess(res, { items: [], truncated: false });
      }
      throw e;
    }
    if (!hasCatalogSupport(provider)) {
      return sendSuccess(res, { items: [], truncated: false });
    }

    // Task #623: see the categories handler above for why we forward
    // `truncated` to the UI.
    const result = await provider.listCatalogItems(categoryId);
    sendSuccess(res, result);
  } catch (error) {
    log.error('Catalog list error:', error);
    sendError(res, 'Failed to fetch catalog items');
  }
});

export default router;
