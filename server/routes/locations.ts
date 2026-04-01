import { Router } from 'express';
import { z } from 'zod';
import { sendSuccess, sendError, handleZodError } from '../utils/api.js';
import { storage } from '../storage';
import { insertLocationSchema, updateLocationSchema, locationSquareCredentialsSchema, locationCardPointeCredentialsSchema, PAYMENT_PROVIDERS } from '@shared/schema';
import { filterByOrganization } from '../middleware/organization.js';
import { createLogger } from '../logger';
import { clearProviderCache } from '../services/payment-provider-factory';

const log = createLogger("Locations");

const router = Router();

router.get('/', filterByOrganization, async (req: any, res) => {
  try {
    const organizationId = req.organizationFilter;
    const isSystemAdmin = req.user?.role === 'system_admin';
    let locations;
    if (organizationId !== null && organizationId !== undefined) {
      locations = await storage.getLocations(organizationId);
    } else if (isSystemAdmin) {
      locations = await storage.getAllLocationsSystemAdmin();
    } else {
      return sendSuccess(res, []);
    }
    sendSuccess(res, locations);
  } catch (error) {
    log.error('Error fetching locations:', error);
    sendError(res, 'Failed to fetch locations', 500, 'ServerError');
  }
});

router.get('/:id', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');
    }

    const location = await storage.getLocation(id);
    if (!location) {
      return sendError(res, 'Location not found', 404, 'NotFound');
    }

    if (req.user?.role !== 'system_admin' && req.user?.organizationId !== location.organizationId) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    sendSuccess(res, location);
  } catch (error) {
    log.error(`Error fetching location with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to fetch location', 500, 'ServerError');
  }
});

router.post('/', async (req: any, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId && req.user?.role !== 'system_admin') {
      return sendError(res, 'Organization required', 400, 'InvalidRequest');
    }

    const body = { ...req.body, organizationId: req.body.organizationId || organizationId };
    const validatedData = insertLocationSchema.parse(body);

    if (req.user?.role !== 'system_admin' && validatedData.organizationId !== organizationId) {
      return sendError(res, 'Cannot create location for another organization', 403, 'Forbidden');
    }

    const location = await storage.createLocation(validatedData);
    sendSuccess(res, location, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    log.error('Error creating location:', error);
    sendError(res, 'Failed to create location', 500, 'ServerError');
  }
});

router.patch('/:id', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');
    }

    const location = await storage.getLocation(id);
    if (!location) {
      return sendError(res, 'Location not found', 404, 'NotFound');
    }

    if (req.user?.role !== 'system_admin' && req.user?.organizationId !== location.organizationId) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    const validatedData = updateLocationSchema.parse(req.body);
    const cleanedData: Record<string, any> = {};
    for (const [key, value] of Object.entries(validatedData)) {
      if (value !== undefined && value !== null) {
        cleanedData[key] = value;
      }
    }
    const updatedLocation = await storage.updateLocation(id, cleanedData);
    if ('paymentProvider' in cleanedData || 'squareCredentials' in cleanedData || 'cardpointeCredentials' in cleanedData) {
      clearProviderCache(id);
    }
    sendSuccess(res, updatedLocation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    log.error(`Error updating location with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to update location', 500, 'ServerError');
  }
});

router.patch('/:id/archive', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');
    }

    const location = await storage.getLocation(id);
    if (!location) {
      return sendError(res, 'Location not found', 404, 'NotFound');
    }

    if (req.user?.role !== 'system_admin' && req.user?.organizationId !== location.organizationId) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    const archived = await storage.archiveLocation(id);
    sendSuccess(res, archived);
  } catch (error) {
    log.error(`Error archiving location with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to archive location', 500, 'ServerError');
  }
});

router.patch('/:id/restore', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');
    }

    const location = await storage.getLocation(id);
    if (!location) {
      return sendError(res, 'Location not found', 404, 'NotFound');
    }

    if (req.user?.role !== 'system_admin' && req.user?.organizationId !== location.organizationId) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    const restored = await storage.restoreLocation(id);
    sendSuccess(res, restored);
  } catch (error) {
    log.error(`Error restoring location with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to restore location', 500, 'ServerError');
  }
});

router.delete('/:id', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');
    }

    const location = await storage.getLocation(id);
    if (!location) {
      return sendError(res, 'Location not found', 404, 'NotFound');
    }

    if (req.user?.role !== 'system_admin' && req.user?.organizationId !== location.organizationId) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    await storage.deleteLocation(id);
    sendSuccess(res, { message: 'Location deleted successfully' });
  } catch (error) {
    log.error(`Error deleting location with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to delete location', 500, 'ServerError');
  }
});

router.get('/:id/square-config', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');

    const location = await storage.getLocation(id);
    if (!location) return sendError(res, 'Location not found', 404, 'NotFound');

    const isOrgAdmin = req.user?.role === 'org_admin' || req.user?.role === 'system_admin';
    const hasAccess = req.user?.role === 'system_admin' || req.user?.organizationId === location.organizationId;
    if (!isOrgAdmin || !hasAccess) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    const creds = await storage.getLocationSquareConfig(id);
    sendSuccess(res, {
      appId: creds?.appId || null,
      accessTokenConfigured: !!(creds?.accessToken && creds.accessToken.trim().length > 0),
      locationId: creds?.locationId || null,
    });
  } catch (error) {
    log.error(`Error fetching Square config for location ${req.params.id}:`, error);
    sendError(res, 'Failed to fetch Square configuration', 500, 'ServerError');
  }
});

router.patch('/:id/square-config', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');

    const location = await storage.getLocation(id);
    if (!location) return sendError(res, 'Location not found', 404, 'NotFound');

    const isOrgAdmin = req.user?.role === 'org_admin' || req.user?.role === 'system_admin';
    const hasAccess = req.user?.role === 'system_admin' || req.user?.organizationId === location.organizationId;
    if (!isOrgAdmin || !hasAccess) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    const parseResult = locationSquareCredentialsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return handleZodError(res, parseResult.error);
    }

    const incoming = parseResult.data ?? {};

    // Preserve existing accessToken if not provided in this request
    const existing = await storage.getLocationSquareConfig(id);
    const creds = {
      appId: incoming.appId !== undefined ? (incoming.appId || undefined) : (existing?.appId || undefined),
      accessToken: incoming.accessToken !== undefined ? (incoming.accessToken || undefined) : (existing?.accessToken || undefined),
      locationId: incoming.locationId !== undefined ? (incoming.locationId || undefined) : (existing?.locationId || undefined),
    };

    await storage.updateLocationSquareConfig(id, creds);
    clearProviderCache(id);
    sendSuccess(res, {
      appId: creds.appId || null,
      accessTokenConfigured: !!(creds.accessToken && creds.accessToken.trim().length > 0),
      locationId: creds.locationId || null,
    });
  } catch (error) {
    log.error(`Error updating Square config for location ${req.params.id}:`, error);
    sendError(res, 'Failed to update Square configuration', 500, 'ServerError');
  }
});

router.get('/:id/cardpointe-config', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');

    const location = await storage.getLocation(id);
    if (!location) return sendError(res, 'Location not found', 404, 'NotFound');

    const isOrgAdmin = req.user?.role === 'org_admin' || req.user?.role === 'system_admin';
    const hasAccess = req.user?.role === 'system_admin' || req.user?.organizationId === location.organizationId;
    if (!isOrgAdmin || !hasAccess) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    const creds = await storage.getLocationCardPointeConfig(id);
    sendSuccess(res, {
      merchantId: creds?.merchantId || null,
      apiUsernameConfigured: !!(creds?.apiUsername && creds.apiUsername.trim().length > 0),
      apiPasswordConfigured: !!(creds?.apiPassword && creds.apiPassword.trim().length > 0),
      siteUrl: creds?.siteUrl || null,
    });
  } catch (error) {
    log.error(`Error fetching CardPointe config for location ${req.params.id}:`, error);
    sendError(res, 'Failed to fetch CardPointe configuration', 500, 'ServerError');
  }
});

router.patch('/:id/cardpointe-config', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');

    const location = await storage.getLocation(id);
    if (!location) return sendError(res, 'Location not found', 404, 'NotFound');

    const isOrgAdmin = req.user?.role === 'org_admin' || req.user?.role === 'system_admin';
    const hasAccess = req.user?.role === 'system_admin' || req.user?.organizationId === location.organizationId;
    if (!isOrgAdmin || !hasAccess) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    const parseResult = locationCardPointeCredentialsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return handleZodError(res, parseResult.error);
    }

    const incoming = parseResult.data ?? {};
    const existing = await storage.getLocationCardPointeConfig(id);
    const creds = {
      merchantId: incoming.merchantId !== undefined ? (incoming.merchantId || undefined) : (existing?.merchantId || undefined),
      apiUsername: incoming.apiUsername !== undefined ? (incoming.apiUsername || undefined) : (existing?.apiUsername || undefined),
      apiPassword: incoming.apiPassword !== undefined ? (incoming.apiPassword || undefined) : (existing?.apiPassword || undefined),
      siteUrl: incoming.siteUrl !== undefined ? (incoming.siteUrl || undefined) : (existing?.siteUrl || undefined),
    };

    await storage.updateLocationCardPointeConfig(id, creds);
    clearProviderCache(id);
    sendSuccess(res, {
      merchantId: creds.merchantId || null,
      apiUsernameConfigured: !!(creds.apiUsername && creds.apiUsername.trim().length > 0),
      apiPasswordConfigured: !!(creds.apiPassword && creds.apiPassword.trim().length > 0),
      siteUrl: creds.siteUrl || null,
    });
  } catch (error) {
    log.error(`Error updating CardPointe config for location ${req.params.id}:`, error);
    sendError(res, 'Failed to update CardPointe configuration', 500, 'ServerError');
  }
});

router.patch('/:id/payment-provider', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');

    const location = await storage.getLocation(id);
    if (!location) return sendError(res, 'Location not found', 404, 'NotFound');

    const isOrgAdmin = req.user?.role === 'org_admin' || req.user?.role === 'system_admin';
    const hasAccess = req.user?.role === 'system_admin' || req.user?.organizationId === location.organizationId;
    if (!isOrgAdmin || !hasAccess) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    const schema = z.object({ paymentProvider: z.enum(PAYMENT_PROVIDERS) });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return handleZodError(res, parseResult.error);
    }

    await storage.updateLocation(id, { paymentProvider: parseResult.data.paymentProvider });
    clearProviderCache(id);
    sendSuccess(res, { paymentProvider: parseResult.data.paymentProvider });
  } catch (error) {
    log.error(`Error updating payment provider for location ${req.params.id}:`, error);
    sendError(res, 'Failed to update payment provider', 500, 'ServerError');
  }
});

export default router;
