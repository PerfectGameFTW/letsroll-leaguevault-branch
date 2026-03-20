import { Router, Response } from 'express';
import { sendSuccess, sendError } from '../utils/api.js';
import { isOrgBNConfigured, syncBowlerToBN, syncAllBowlersToBN } from '../services/bowlnow.js';
import { storage } from '../storage.js';

const router = Router();

router.get('/status', async (req: any, res: Response) => {
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

router.post('/sync-bowler/:id', async (req: any, res: Response) => {
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
    console.error('[BowlNow Route] Error syncing bowler:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to sync bowler');
  }
});

router.post('/sync-all', async (req: any, res: Response) => {
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
    const results = await syncAllBowlersToBN(orgConfig);
    sendSuccess(res, results);
  } catch (error) {
    console.error('[BowlNow Route] Error syncing all bowlers:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to sync bowlers');
  }
});

export default router;
