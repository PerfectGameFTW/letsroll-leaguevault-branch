import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendError, sendSuccess, sanitizeUser, handleZodError } from '../utils/api';
import { storage } from '../storage';
import { hashPassword } from '../auth';
import { passwordSchema } from '@shared/password-validation';
import { updateUserSchema } from '@shared/schema';
import { getPaymentProvider, ProviderNotConfiguredError } from '../services/payment-provider-factory';
import { scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { createLogger } from '../logger';

const log = createLogger("UserUpdate");

const scryptAsync = promisify(scrypt);

async function comparePasswords(supplied: string, stored: string) {
  try {
    const [hashed, salt] = stored.split(".");
    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
    return timingSafeEqual(hashedBuf, suppliedBuf);
  } catch {
    return false;
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
  }
  next();
}

const router = Router();

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
              log.info('Synced profile changes to bowler record:', bowler.id);
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
                log.info('No payment-configured location found, skipping customer sync');
              }
              let squareCustomer = null;
              if (resolvedSquareLocationId) {
                try {
                  const userProvider = await getPaymentProvider(resolvedSquareLocationId);
                  squareCustomer = await userProvider.createOrUpdateCustomer(
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
              if (squareCustomer && squareCustomer.id !== bowler.paymentCustomerId) {
                await storage.updateBowler(bowler.id, {
                  ...bowler,
                  ...bowlerUpdate,
                  paymentCustomerId: squareCustomer.id,
                });
                log.info('Linked Square customer to bowler:', squareCustomer.id);
              }
            }
          }
        } catch (syncError) {
          log.error('Error syncing to bowler/Square (non-fatal):', syncError);
        }
      }
    }

    return sendSuccess(res, sanitizeUser(updatedUser));
  } catch (error) {
    log.error('Error updating user:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

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