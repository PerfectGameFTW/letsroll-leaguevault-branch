/**
 * Apple Pay domain registration (single + bulk).
 *
 * Routes:
 *  - POST /apple-pay/register-all-domains   (system-admin; enqueues a background job, returns 202 + jobId)
 *  - GET  /apple-pay/jobs/:id              (system-admin; poll job status + per-item results)
 *  - GET  /apple-pay/jobs                  (system-admin; recent jobs)
 *  - POST /apple-pay/register-domain        (sync, single-domain — unchanged)
 */
import { Router } from 'express';
import { storage } from '../../storage';
import { sendSuccess, sendError } from '../../utils/api.js';
import { createLogger } from '../../logger';
import { getPaymentProvider, ProviderNotConfiguredError } from '../../services/payment-provider-factory';
import { hasWalletSupport } from '../../services/payment-provider';
import { applePayWorker } from '../../services/apple-pay-worker';

const log = createLogger('Payments');

const router = Router();

router.post('/apple-pay/register-all-domains', async (req: any, res) => {
  try {
    if (req.user?.role !== 'system_admin') {
      return sendError(res, 'System admin access required', 403, 'FORBIDDEN');
    }

    const job = await applePayWorker.enqueue(req.user?.id ?? null);

    res.status(202).json({
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        createdAt: job.createdAt,
        message: 'Bulk Apple Pay registration enqueued. Poll GET /api/payments-provider/apple-pay/jobs/:id for status.',
      },
    });
  } catch (error) {
    log.error('Apple Pay bulk registration enqueue error:', error);
    sendError(res, 'Failed to enqueue bulk Apple Pay registration job', 500);
  }
});

router.get('/apple-pay/jobs', async (req: any, res) => {
  try {
    if (req.user?.role !== 'system_admin') {
      return sendError(res, 'System admin access required', 403, 'FORBIDDEN');
    }
    const jobs = await storage.listApplePayJobs(25);
    sendSuccess(res, { jobs });
  } catch (error) {
    log.error('Apple Pay list jobs error:', error);
    sendError(res, 'Failed to list jobs', 500);
  }
});

router.get('/apple-pay/jobs/:id', async (req: any, res) => {
  try {
    if (req.user?.role !== 'system_admin') {
      return sendError(res, 'System admin access required', 403, 'FORBIDDEN');
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return sendError(res, 'Invalid job id', 400, 'INVALID_ID');

    const job = await storage.getApplePayJob(id);
    if (!job) return sendError(res, 'Job not found', 404, 'NOT_FOUND');

    // Live counts from the items table — these stay accurate while the job is
    // mid-flight (the job row's counts are only finalized at job completion).
    const [items, liveCounts] = await Promise.all([
      storage.getApplePayJobItems(id),
      storage.getApplePayJobItemCounts(id),
    ]);

    sendSuccess(res, {
      job,
      counts: {
        total: job.totalDomains,
        succeeded: liveCounts.succeeded,
        failed: liveCounts.failed,
        skipped: liveCounts.skipped,
        pending: liveCounts.pending,
      },
      items,
    });
  } catch (error) {
    log.error('Apple Pay job status error:', error);
    sendError(res, 'Failed to fetch job status', 500);
  }
});

router.post('/apple-pay/jobs/:id/cancel', async (req: any, res) => {
  try {
    if (req.user?.role !== 'system_admin') {
      return sendError(res, 'System admin access required', 403, 'FORBIDDEN');
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return sendError(res, 'Invalid job id', 400, 'INVALID_ID');

    const existing = await storage.getApplePayJob(id);
    if (!existing) return sendError(res, 'Job not found', 404, 'NOT_FOUND');

    const updated = await storage.cancelApplePayJob(id);
    if (!updated) {
      return sendError(
        res,
        `Job is ${existing.status}; only pending or running jobs can be canceled.`,
        409,
        'NOT_CANCELABLE',
      );
    }
    log.warn('Apple Pay job canceled by admin', { jobId: id, by: req.user?.id });
    sendSuccess(res, { job: updated });
  } catch (error) {
    log.error('Apple Pay job cancel error:', error);
    sendError(res, 'Failed to cancel job', 500);
  }
});

router.post('/apple-pay/jobs/:id/retry', async (req: any, res) => {
  try {
    if (req.user?.role !== 'system_admin') {
      return sendError(res, 'System admin access required', 403, 'FORBIDDEN');
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return sendError(res, 'Invalid job id', 400, 'INVALID_ID');

    const existing = await storage.getApplePayJob(id);
    if (!existing) return sendError(res, 'Job not found', 404, 'NOT_FOUND');

    const result = await storage.retryApplePayJob(id);
    if (!result) {
      return sendError(
        res,
        `No failed items to retry on this job (status: ${existing.status}).`,
        409,
        'NOT_RETRYABLE',
      );
    }
    applePayWorker.kick();
    log.info('Apple Pay job retried by admin', { jobId: id, by: req.user?.id, resetCount: result.resetCount });
    sendSuccess(res, { job: result.job, resetCount: result.resetCount });
  } catch (error) {
    log.error('Apple Pay job retry error:', error);
    sendError(res, 'Failed to retry job', 500);
  }
});

router.post('/apple-pay/jobs/:id/items/:itemId/retry', async (req: any, res) => {
  try {
    if (req.user?.role !== 'system_admin') {
      return sendError(res, 'System admin access required', 403, 'FORBIDDEN');
    }
    const id = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(id) || isNaN(itemId)) return sendError(res, 'Invalid id', 400, 'INVALID_ID');

    const existing = await storage.getApplePayJob(id);
    if (!existing) return sendError(res, 'Job not found', 404, 'NOT_FOUND');

    const result = await storage.retryApplePayJobItem(id, itemId);
    if (!result) {
      return sendError(
        res,
        `Item is not retryable (job status: ${existing.status}). Items can only be retried on failed/partial/canceled jobs.`,
        409,
        'NOT_RETRYABLE',
      );
    }
    applePayWorker.kick();
    log.info('Apple Pay job item retried by admin', { jobId: id, itemId, by: req.user?.id });
    sendSuccess(res, { item: result.item, job: result.job });
  } catch (error) {
    log.error('Apple Pay item retry error:', error);
    sendError(res, 'Failed to retry item', 500);
  }
});

router.post('/apple-pay/register-domain', async (req: any, res) => {
  try {
    if (req.user?.role !== 'system_admin' && req.user?.role !== 'org_admin') {
      return sendError(res, 'Admin access required', 403, 'FORBIDDEN');
    }

    const { domain, locationId } = req.body;
    if (!domain || typeof domain !== 'string') {
      return sendError(res, 'Domain is required', 400, 'VALIDATION_ERROR');
    }

    if (req.user.role === 'org_admin' && req.user.organizationId) {
      const org = await storage.getOrganization(req.user.organizationId);
      if (org) {
        const orgDomain = org.subdomain || org.slug;
        const expectedDomain = `${orgDomain}.leaguevault.app`;
        if (domain !== expectedDomain) {
          return sendError(res, 'Domain does not match your organization', 403, 'FORBIDDEN');
        }
      }

      if (locationId) {
        const location = await storage.getLocation(parseInt(locationId));
        if (!location || location.organizationId !== req.user.organizationId) {
          return sendError(res, 'Location does not belong to your organization', 403, 'FORBIDDEN');
        }
      }
    }

    const lvLocationId = locationId ? parseInt(locationId) : null;
    let provider;
    try {
      provider = await getPaymentProvider(lvLocationId);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        return sendError(res, 'Payment provider not configured for this location', 422, 'PROVIDER_NOT_CONFIGURED');
      }
      throw e;
    }
    if (!hasWalletSupport(provider)) {
      return sendError(res, 'Payment provider does not support Apple Pay', 400, 'UNSUPPORTED_FEATURE');
    }

    const result = await provider.registerApplePayDomain(domain);

    if (result.success) {
      sendSuccess(res, result);
    } else {
      sendError(res, result.message, 400, 'REGISTRATION_FAILED');
    }
  } catch (error) {
    log.error('Apple Pay domain registration error:', error);
    sendError(res, 'Failed to register domain for Apple Pay', 500);
  }
});

export default router;
