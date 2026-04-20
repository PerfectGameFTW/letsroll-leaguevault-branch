/**
 * Catalog reads for providers that support them (e.g. Square).
 *
 * Routes:
 *  - GET /catalog/categories
 *  - GET /catalog/items
 */
import { Router } from 'express';
import { storage } from '../../storage';
import { sendSuccess, sendError } from '../../utils/api.js';
import { createLogger } from '../../logger';
import { getPaymentProvider, ProviderNotConfiguredError } from '../../services/payment-provider-factory';
import { hasCatalogSupport } from '../../services/payment-provider';

const log = createLogger('Payments');

const router = Router();

router.get('/catalog/categories', async (req: any, res) => {
  try {
    const locationIdParam = req.query.locationId as string | undefined;
    const lvLocationId = locationIdParam ? parseInt(locationIdParam) : null;

    if (lvLocationId && !isNaN(lvLocationId)) {
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
        return sendSuccess(res, []);
      }
      throw e;
    }
    if (!hasCatalogSupport(provider)) {
      return sendSuccess(res, []);
    }

    const categories = await provider.listCatalogCategories();
    sendSuccess(res, categories);
  } catch (error) {
    log.error('Catalog categories error:', error);
    sendError(res, 'Failed to fetch catalog categories');
  }
});

router.get('/catalog/items', async (req: any, res) => {
  try {
    const categoryId = req.query.categoryId as string | undefined;
    const locationIdParam = req.query.locationId as string | undefined;
    const lvLocationId = locationIdParam ? parseInt(locationIdParam) : null;

    if (lvLocationId && !isNaN(lvLocationId)) {
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
        return sendSuccess(res, []);
      }
      throw e;
    }
    if (!hasCatalogSupport(provider)) {
      return sendSuccess(res, []);
    }

    const items = await provider.listCatalogItems(categoryId);
    sendSuccess(res, items);
  } catch (error) {
    log.error('Catalog list error:', error);
    sendError(res, 'Failed to fetch catalog items');
  }
});

export default router;
