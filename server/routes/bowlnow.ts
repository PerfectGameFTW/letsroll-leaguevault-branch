import { Router, Response } from 'express';
import { sendSuccess, sendError } from '../utils/api.js';
import { isBNConfigured, isOrgBNConfigured, syncBowlerToBN, syncAllBowlersToBN } from '../services/bowlnow.js';
import { storage } from '../storage.js';

const router = Router();

router.get('/status', async (req: any, res: Response) => {
  try {
    const orgId = req.user?.organizationId;

    if (orgId) {
      const orgConfig = await storage.getOrgIntegrations(orgId);
      sendSuccess(res, { configured: isOrgBNConfigured(orgConfig) });
    } else {
      sendSuccess(res, { configured: isBNConfigured() });
    }
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

    const orgId = req.user?.organizationId;
    const orgConfig = orgId ? await storage.getOrgIntegrations(orgId) : null;

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

    const orgId = req.user?.organizationId;
    const orgConfig = orgId ? await storage.getOrgIntegrations(orgId) : null;

    const results = await syncAllBowlersToBN(orgConfig);
    sendSuccess(res, results);
  } catch (error) {
    console.error('[BowlNow Route] Error syncing all bowlers:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to sync bowlers');
  }
});

export default router;
