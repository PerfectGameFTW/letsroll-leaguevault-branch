import { Router, Response } from 'express';
import { sendSuccess, sendError } from '../utils/api.js';
import { isBNConfigured, syncBowlerToBN, syncAllBowlersToBN } from '../services/bowlnow.js';

const router = Router();

router.get('/status', async (req: any, res: Response) => {
  try {
    sendSuccess(res, { configured: isBNConfigured() });
  } catch (error) {
    sendError(res, 'Failed to check BowlNow status');
  }
});

router.post('/sync-bowler/:id', async (req: any, res: Response) => {
  try {
    if (!req.user?.isAdmin && !req.user?.isOrganizationAdmin) {
      return sendError(res, 'Admin access required', 403, 'FORBIDDEN');
    }

    const bowlerId = parseInt(req.params.id, 10);
    if (isNaN(bowlerId)) {
      return sendError(res, 'Invalid bowler ID', 400, 'BAD_REQUEST');
    }

    const result = await syncBowlerToBN(bowlerId);
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
    if (!req.user?.isAdmin && !req.user?.isOrganizationAdmin) {
      return sendError(res, 'Admin access required', 403, 'FORBIDDEN');
    }

    const results = await syncAllBowlersToBN();
    sendSuccess(res, results);
  } catch (error) {
    console.error('[BowlNow Route] Error syncing all bowlers:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to sync bowlers');
  }
});

export default router;
