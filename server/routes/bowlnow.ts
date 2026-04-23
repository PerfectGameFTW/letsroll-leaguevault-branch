import { Router, Response } from 'express';
import { sendSuccess, sendError } from '../utils/api.js';
import { isOrgBNConfigured, syncBowlerToBN, syncAllBowlersToBN } from '../services/bowlnow.js';
import { storage } from '../storage';
import { createLogger } from '../logger';

const log = createLogger("BowlNow");

const router = Router();

router.get('/status', async (req, res) => {
  try {
    const isSystemAdmin = req.user?.role === 'system_admin';

    let orgId: number | null = req.user?.organizationId ?? null;

    if (isSystemAdmin && !orgId) {
      const fromQuery = req.query?.organizationId
        ? parseInt(req.query.organizationId as string, 10)
        : null;
      if (fromQuery && !isNaN(fromQuery)) {
        orgId = fromQuery;
      }
    }

    if (!orgId) {
      return sendSuccess(res, { configured: false });
    }

    const orgConfig = await storage.getOrgIntegrations(orgId);
    sendSuccess(res, { configured: isOrgBNConfigured(orgConfig) });
  } catch (error) {
    sendError(res, 'Failed to check BowlNow status');
  }
});

router.post('/sync-bowler/:id', async (req, res) => {
  try {
    if (req.user?.role !== 'system_admin' && req.user?.role !== 'org_admin') {
      return sendError(res, 'Admin access required', 403, 'FORBIDDEN');
    }

    const bowlerId = parseInt(req.params.id, 10);
    if (isNaN(bowlerId)) {
      return sendError(res, 'Invalid bowler ID', 400, 'BAD_REQUEST');
    }

    const orgId = req.user?.organizationId
      ?? (req.body?.organizationId ? parseInt(String(req.body.organizationId), 10) : null);

    if (!orgId) {
      return sendError(res, 'No organization context for BowlNow sync', 400, 'BAD_REQUEST');
    }

    const orgConfig = await storage.getOrgIntegrations(orgId);
    const result = await syncBowlerToBN(bowlerId, orgConfig);
    if (result.success) {
      sendSuccess(res, { contactId: result.contactId });
    } else {
      sendError(res, result.error || 'Sync failed', 500);
    }
  } catch (error) {
    log.error('Error syncing bowler:', error);
    sendError(res, 'Failed to sync bowler');
  }
});

router.post('/sync-all', async (req, res) => {
  try {
    if (req.user?.role !== 'system_admin' && req.user?.role !== 'org_admin') {
      return sendError(res, 'Admin access required', 403, 'FORBIDDEN');
    }

    const orgId = req.user?.organizationId
      ?? (req.body?.organizationId ? parseInt(String(req.body.organizationId), 10) : null);

    if (!orgId) {
      return sendError(res, 'No organization context for BowlNow sync', 400, 'BAD_REQUEST');
    }

    const orgConfig = await storage.getOrgIntegrations(orgId);
    const results = await syncAllBowlersToBN(orgId, orgConfig);
    sendSuccess(res, results);
  } catch (error) {
    log.error('Error syncing all bowlers:', error);
    sendError(res, 'Failed to sync bowlers');
  }
});

export default router;
