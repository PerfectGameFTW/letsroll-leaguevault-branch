import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { sendError, sendSuccess, sanitizeUser, handleZodError } from '../utils/api';
import { storage } from '../storage';
import { hashPassword } from '../auth';
import { passwordSchema } from '@shared/password-validation';
import { updateUserSchema, insertDeletionRequestSchema } from '@shared/schema';
import { getPaymentProvider, ProviderNotConfiguredError } from '../services/payment-provider-factory';
import { createLogger } from '../logger';
import { isDev } from '../config';
import { comparePasswords } from '../lib/password';
import { sendDeletionRequestNotification } from '../services/email';

const log = createLogger('Account');
const router = Router();

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

    const profileUpdateSchema = updateUserSchema.pick({ name: true, email: true, phone: true });

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

    if (updatedUser.bowlerId) {
      const emailChanged = updateData.email && updateData.email !== existingUser.email;
      const nameChanged = updateData.name && updateData.name !== existingUser.name;
      const phoneChanged = updateData.phone !== undefined && updateData.phone !== existingUser.phone;

      if (emailChanged || nameChanged || phoneChanged) {
        try {
          const bowler = await storage.getBowler(updatedUser.bowlerId);
          if (bowler) {
            const bowlerUpdate: Record<string, any> = {};
            if (nameChanged) bowlerUpdate.name = updatedUser.name;
            if (emailChanged) bowlerUpdate.email = updatedUser.email;
            if (phoneChanged) bowlerUpdate.phone = updatedUser.phone;

            if (Object.keys(bowlerUpdate).length > 0) {
              await storage.updateBowler(bowler.id, { ...bowler, ...bowlerUpdate });
              if (isDev) log.info('Synced profile changes to bowler record:', bowler.id);
            }

            if (updatedUser.email && (emailChanged || nameChanged || phoneChanged)) {
              let resolvedSquareLocationId: number | null = null;
              if (updatedUser.locationId) {
                const locationCreds = await storage.getLocationSquareConfig(updatedUser.locationId);
                if ((locationCreds?.accessToken ?? '').trim().length > 0) {
                  resolvedSquareLocationId = updatedUser.locationId;
                }
              }
              if (!resolvedSquareLocationId && updatedUser.organizationId) {
                const sq = await storage.getFirstSquareConfiguredLocation(updatedUser.organizationId);
                resolvedSquareLocationId = sq?.id ?? null;
              }
              if (!resolvedSquareLocationId) {
                if (isDev) log.info('No payment-configured location found, skipping customer sync');
              }
              let providerCustomer = null;
              if (resolvedSquareLocationId) {
                try {
                  const userProvider = await getPaymentProvider(resolvedSquareLocationId);
                  providerCustomer = await userProvider.createOrUpdateCustomer(
                    updatedUser.name,
                    updatedUser.email,
                    updatedUser.phone,
                  );
                } catch (e) {
                  if (e instanceof ProviderNotConfiguredError) {
                    log.warn('User update: provider not configured, skipping customer sync', { locationId: resolvedSquareLocationId });
                  } else {
                    throw e;
                  }
                }
              }
              if (providerCustomer && providerCustomer.id !== bowler.paymentCustomerId) {
                await storage.updateBowler(bowler.id, {
                  ...bowler,
                  ...bowlerUpdate,
                  paymentCustomerId: providerCustomer.id,
                });
                log.info('Linked payment customer to bowler:', providerCustomer.id);
              }
            }
          }
        } catch (syncError) {
          log.error('Error syncing bowler payment customer (non-fatal):', syncError);
        }
      }
    }

    return sendSuccess(res, sanitizeUser(updatedUser));
  } catch (error) {
    log.error('Error updating user:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

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
