import { Router, Response } from 'express';
import { sendSuccess, sendError } from '../utils/api.js';
import { storage } from '../storage';
import type { OrgIntegrations } from '@shared/schema';
import { z } from 'zod';

const router = Router();

router.use((req: any, res: Response, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return sendError(res, 'Authentication required', 401, 'UNAUTHORIZED');
  }
  if (req.user?.role !== 'system_admin' && req.user?.role !== 'org_admin') {
    return sendError(res, 'Admin access required', 403, 'FORBIDDEN');
  }
  next();
});

function resolveOrgId(req: any): number | null {
  const isSystemAdmin = req.user?.role === 'system_admin';

  if (isSystemAdmin) {
    const fromQuery = req.query?.organizationId
      ? parseInt(req.query.organizationId as string, 10)
      : null;
    const fromBody = req.body?.organizationId
      ? parseInt(String(req.body.organizationId), 10)
      : null;
    const resolved = fromQuery || fromBody || req.user?.organizationId;
    return resolved ?? null;
  }

  return req.user?.organizationId ?? null;
}

router.get('/', async (req: any, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    if (!orgId) {
      return sendError(res, 'No organization context', 400, 'BAD_REQUEST');
    }

    const integrations = await storage.getOrgIntegrations(orgId);

    const response = {
      bowlnow: {
        enabled: integrations?.bowlnow?.enabled ?? false,
        apiKeyConfigured: !!integrations?.bowlnow?.apiKey,
        locationId: integrations?.bowlnow?.locationId ?? '',
      },
    };

    sendSuccess(res, response);
  } catch (error) {
    console.error('[Integrations] Error fetching integrations:', error);
    sendError(res, 'Failed to fetch integrations');
  }
});

const updateIntegrationsSchema = z.object({
  organizationId: z.number().int().positive().optional(),
  bowlnow: z.object({
    enabled: z.boolean(),
    apiKey: z.string().optional(),
    locationId: z.string().optional(),
  }).optional(),
});

router.patch('/', async (req: any, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    if (!orgId) {
      return sendError(res, 'No organization context', 400, 'BAD_REQUEST');
    }

    const parsed = updateIntegrationsSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, parsed.error.errors.map(e => e.message).join(', '), 400, 'VALIDATION_ERROR');
    }

    const existing = await storage.getOrgIntegrations(orgId);
    const updated: OrgIntegrations = { ...existing };

    if (parsed.data.bowlnow !== undefined) {
      const incoming = parsed.data.bowlnow;
      const resolvedApiKey = (incoming.apiKey !== undefined && incoming.apiKey !== '')
        ? incoming.apiKey
        : existing?.bowlnow?.apiKey;

      if (incoming.enabled && !resolvedApiKey) {
        return sendError(res, 'An API key is required to enable BowlNow', 400, 'VALIDATION_ERROR');
      }

      updated.bowlnow = {
        enabled: incoming.enabled,
        apiKey: resolvedApiKey,
        locationId: incoming.locationId !== undefined
          ? incoming.locationId
          : existing?.bowlnow?.locationId,
      };
    }

    await storage.updateOrgIntegrations(orgId, updated);

    const response = {
      bowlnow: {
        enabled: updated.bowlnow?.enabled ?? false,
        apiKeyConfigured: !!updated.bowlnow?.apiKey,
        locationId: updated.bowlnow?.locationId ?? '',
      },
    };

    sendSuccess(res, response);
  } catch (error) {
    console.error('[Integrations] Error updating integrations:', error);
    sendError(res, 'Failed to update integrations');
  }
});

export default router;
