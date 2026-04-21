import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { sendError, sendSuccess, sanitizeUser, handleZodError } from '../utils/api';
import { storage } from '../storage';
import { hashPassword } from '../auth';
import { passwordSchema } from '@shared/password-validation';
import { updateUserSchemaBase, insertDeletionRequestSchema } from '@shared/schema';
import { getPaymentProvider, ProviderNotConfiguredError } from '../services/payment-provider-factory';
import { createLogger } from '../logger';
import { isDev } from '../config';
import { comparePasswords } from '../lib/password';
import { sendDeletionRequestNotification } from '../services/email';
import { requireSystemAdmin } from '../middleware/auth';

const log = createLogger('Account');
const router = Router();

type PaymentSyncStatus = 'synced' | 'skipped' | 'pending_retry' | 'not_applicable';

/**
 * Push profile changes onto the linked bowler row and (when applicable)
 * the payment provider's customer record. Returns a status the API caller
 * can use to surface a "your payment record may be stale, we'll retry"
 * notice when the provider call fails for a real reason. Real failures
 * also flip `bowlers.payment_sync_pending_at` so the admin retry endpoint
 * (POST /api/account/bowlers/:id/retry-payment-sync) and the next profile
 * edit can re-attempt without losing track of the work.
 */
async function syncBowlerForUser(
  user: { id: number; bowlerId: number | null; name: string; email: string | null; phone: string | null; locationId: number | null; organizationId: number | null },
  changed: { nameChanged: boolean; emailChanged: boolean; phoneChanged: boolean },
): Promise<PaymentSyncStatus> {
  if (!user.bowlerId) return 'not_applicable';

  const bowler = await storage.getBowler(user.bowlerId);
  if (!bowler) return 'not_applicable';

  const bowlerUpdate: Record<string, any> = {};
  if (changed.nameChanged) bowlerUpdate.name = user.name;
  if (changed.emailChanged) bowlerUpdate.email = user.email;
  if (changed.phoneChanged) bowlerUpdate.phone = user.phone;

  if (Object.keys(bowlerUpdate).length > 0) {
    try {
      await storage.updateBowler(bowler.id, { ...bowler, ...bowlerUpdate });
      if (isDev) log.info('Synced profile changes to bowler record:', bowler.id);
    } catch (e) {
      log.error('Failed to write local bowler row during profile sync:', e);
      // Local DB write failed — bail out before touching the remote provider
      // so we don't desync local↔remote state.
      return 'pending_retry';
    }
  }

  if (!user.email) return 'skipped';

  let resolvedSquareLocationId: number | null = null;
  if (user.locationId) {
    const locationCreds = await storage.getLocationSquareConfig(user.locationId);
    if ((locationCreds?.accessToken ?? '').trim().length > 0) {
      resolvedSquareLocationId = user.locationId;
    }
  }
  if (!resolvedSquareLocationId && user.organizationId) {
    const sq = await storage.getFirstSquareConfiguredLocation(user.organizationId);
    resolvedSquareLocationId = sq?.id ?? null;
  }
  if (!resolvedSquareLocationId) {
    if (isDev) log.info('No payment-configured location found, skipping customer sync');
    return 'skipped';
  }

  let providerCustomer: { id: string } | null = null;
  try {
    const userProvider = await getPaymentProvider(resolvedSquareLocationId);
    providerCustomer = await userProvider.createOrUpdateCustomer(
      user.name,
      user.email,
      user.phone,
    );
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) {
      log.warn('User update: provider not configured, skipping customer sync', { locationId: resolvedSquareLocationId });
      return 'skipped';
    }
    // Real provider failure: log with structured context so ops can spot a
    // systemic outage instead of seeing scattered "non-fatal" lines, and
    // flip the bowler's pending flag so we know to retry.
    log.warn('Payment customer sync failed, marking bowler for retry', {
      userId: user.id,
      bowlerId: bowler.id,
      locationId: resolvedSquareLocationId,
      errorName: e instanceof Error ? e.name : 'unknown',
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    try {
      await storage.updateBowler(bowler.id, {
        ...bowler,
        ...bowlerUpdate,
        paymentSyncPendingAt: new Date().toISOString(),
      });
    } catch (markErr) {
      log.error('Failed to flag bowler for payment-sync retry:', markErr);
    }
    return 'pending_retry';
  }

  const updates: Record<string, any> = { ...bowlerUpdate };
  let needsWrite = false;
  if (providerCustomer && providerCustomer.id !== bowler.paymentCustomerId) {
    updates.paymentCustomerId = providerCustomer.id;
    needsWrite = true;
    log.info('Linked payment customer to bowler:', providerCustomer.id);
  }
  // Always clear the retry flag on a successful sync attempt so a previously
  // failed sync doesn't keep the bowler pinned forever.
  if (bowler.paymentSyncPendingAt !== null) {
    updates.paymentSyncPendingAt = null;
    needsWrite = true;
  }
  if (needsWrite) {
    try {
      await storage.updateBowler(bowler.id, { ...bowler, ...updates });
    } catch (e) {
      log.error('Failed to persist post-sync bowler updates:', e);
      return 'pending_retry';
    }
  }
  return 'synced';
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
  }
  next();
}

const GENERIC_DELETION_RESPONSE = {
  success: true as const,
  data: { message: 'Deletion request received' },
};

// Anti-enumeration: even when throttled, return the same generic success
// response (HTTP 200) so callers cannot distinguish accepted vs limited.
const deletionRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    log.warn('Deletion request throttled (per-IP limit reached)');
    res.status(200).json(GENERIC_DELETION_RESPONSE);
  },
});

const MAX_DELETION_REQUESTS_PER_EMAIL_PER_DAY = 3;

// Public: request account deletion (no auth required so departed users can submit)
router.post('/request-deletion', deletionRequestLimiter, async (req, res) => {
  try {
    const rawEmail = typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : req.body?.email;
    const parsed = insertDeletionRequestSchema.safeParse({
      email: rawEmail,
      reason: typeof req.body?.reason === 'string' && req.body.reason.trim().length > 0
        ? req.body.reason.trim()
        : null,
    });

    if (!parsed.success) {
      // Always return generic success to prevent enumeration; just log the failure.
      log.info('Deletion request rejected (invalid input)', {
        issues: parsed.error.issues.map(i => i.message),
      });
      return res.json(GENERIC_DELETION_RESPONSE);
    }

    const { email, reason } = parsed.data;

    // Per-email throttle on top of per-IP limiter
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await storage.countDeletionRequestsForEmailSince(email, since);
    if (recentCount >= MAX_DELETION_REQUESTS_PER_EMAIL_PER_DAY) {
      log.warn('Deletion request throttled (per-email cap reached)', { recentCount });
      return res.json(GENERIC_DELETION_RESPONSE);
    }

    const ipAddress = (req.ip ?? req.socket?.remoteAddress ?? null)?.toString().slice(0, 100) ?? null;
    const userAgent = req.headers['user-agent']?.toString().slice(0, 500) ?? null;

    const created = await storage.createDeletionRequest({
      email,
      reason: reason ?? null,
      ipAddress,
      userAgent,
    });

    log.info('Account deletion request recorded', { id: created.id });

    // Notify system admins (non-fatal)
    try {
      const allUsers = await storage.getUsers();
      const adminEmails = allUsers
        .filter(u => u.role === 'system_admin' && u.email)
        .map(u => u.email);
      if (adminEmails.length > 0) {
        await sendDeletionRequestNotification(adminEmails, {
          id: created.id,
          email: created.email,
          reason: created.reason,
          createdAt: created.createdAt,
        });
      }
    } catch (notifyError) {
      log.error('Failed to notify admins of deletion request (non-fatal):', notifyError);
    }

    return res.json(GENERIC_DELETION_RESPONSE);
  } catch (error) {
    log.error('Error processing deletion request:', error);
    // Still return generic success to avoid leaking error state
    return res.json(GENERIC_DELETION_RESPONSE);
  }
});

// Update user profile (name/email/phone) — also syncs the linked bowler + payment customer
router.patch('/profile/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'INVALID_ID');
    }

    const user = req.user as any;
    if (user.id !== userId && user.role !== 'system_admin') {
      return sendError(res, 'Unauthorized', 403, 'UNAUTHORIZED');
    }

    const profileUpdateSchema = updateUserSchemaBase.pick({ name: true, email: true, phone: true });

    const validationResult = profileUpdateSchema.safeParse(req.body);
    if (!validationResult.success) {
      return handleZodError(res, validationResult.error);
    }

    const updateData = validationResult.data;

    const existingUser = await storage.getUser(userId);
    if (!existingUser) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }

    if (updateData.email && updateData.email !== existingUser.email) {
      const userWithEmail = await storage.getUserByEmail(updateData.email);
      if (userWithEmail && userWithEmail.id !== userId) {
        return sendError(res, 'Email already in use', 400, 'EMAIL_IN_USE');
      }
    }

    const updatedUser = await storage.updateUser(userId, {
      ...updateData,
      phone: updateData.phone === null ? undefined : updateData.phone,
    });

    let paymentSyncStatus: 'synced' | 'skipped' | 'pending_retry' | 'not_applicable' = 'not_applicable';

    if (updatedUser.bowlerId) {
      const emailChanged = updateData.email && updateData.email !== existingUser.email;
      const nameChanged = updateData.name && updateData.name !== existingUser.name;
      const phoneChanged = updateData.phone !== undefined && updateData.phone !== existingUser.phone;

      if (emailChanged || nameChanged || phoneChanged) {
        const result = await syncBowlerForUser(updatedUser, {
          nameChanged: !!nameChanged,
          emailChanged: !!emailChanged,
          phoneChanged: !!phoneChanged,
        });
        paymentSyncStatus = result;
      }
    }

    return sendSuccess(res, { ...sanitizeUser(updatedUser), paymentSyncStatus });
  } catch (error) {
    log.error('Error updating user:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

// Admin-initiated retry for a bowler whose payment-customer sync failed.
// Re-runs the same provider call the profile-update path uses; success
// clears `payment_sync_pending_at`, failure leaves it set.
router.post(
  '/bowlers/:id/retry-payment-sync',
  requireAuth,
  requireSystemAdmin,
  async (req: Request, res: Response) => {
    try {
      const bowlerId = parseInt(req.params.id, 10);
      if (isNaN(bowlerId)) {
        return sendError(res, 'Invalid bowler ID', 400, 'INVALID_ID');
      }

      const bowler = await storage.getBowler(bowlerId);
      if (!bowler) {
        return sendError(res, 'Bowler not found', 404, 'NOT_FOUND');
      }

      // Find the user record linked to this bowler so we can resolve the
      // location/org context for provider lookup. If no user is linked we
      // can't sync — surface a clear 422.
      const linkedUser = await storage.getUserByBowlerId(bowlerId);
      if (!linkedUser) {
        return sendError(
          res,
          'No user is linked to this bowler; cannot retry sync',
          422,
          'NO_LINKED_USER',
        );
      }

      // Source-of-truth for retry is the linked **user's** profile, not the
      // bowler row. The bowler row may carry stale values from the failed
      // sync attempt; the user record reflects what the user submitted.
      // Fall back to bowler fields only when the user record is missing data.
      const status = await syncBowlerForUser(
        {
          id: linkedUser.id,
          bowlerId,
          name: linkedUser.name ?? bowler.name,
          email: linkedUser.email ?? bowler.email,
          phone: linkedUser.phone ?? bowler.phone,
          locationId: linkedUser.locationId,
          organizationId: linkedUser.organizationId,
        },
        { nameChanged: true, emailChanged: true, phoneChanged: true },
      );

      return sendSuccess(res, { paymentSyncStatus: status });
    } catch (error) {
      log.error('Error retrying payment sync:', error);
      return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
    }
  },
);

// Change password for the currently authenticated user
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    const schema = z.object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: passwordSchema,
    });

    const validationResult = schema.safeParse(req.body);
    if (!validationResult.success) {
      return handleZodError(res, validationResult.error);
    }

    const { currentPassword, newPassword } = validationResult.data;

    const existingUser = await storage.getUser(user.id);
    if (!existingUser) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }

    const isValid = await comparePasswords(currentPassword, existingUser.password);
    if (!isValid) {
      return sendError(res, 'Current password is incorrect', 400, 'INVALID_PASSWORD');
    }

    const hashedNew = await hashPassword(newPassword);
    await storage.updateUser(user.id, { password: hashedNew });

    return sendSuccess(res, { message: 'Password updated successfully' });
  } catch (error) {
    log.error('Error changing password:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

export default router;
