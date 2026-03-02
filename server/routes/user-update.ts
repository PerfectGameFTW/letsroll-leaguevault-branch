import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendError, sendSuccess } from '../utils/api';
import { storage } from '../storage';
import { hashPassword } from '../auth';
import { createOrUpdateCustomer } from '../services/square';
import { scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

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
    if (user.id !== userId && !user.isAdmin) {
      return sendError(res, 'Unauthorized', 403, 'UNAUTHORIZED');
    }

    const userUpdateSchema = z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      phone: z.string().nullable().optional(),
      isAdmin: z.boolean().optional(),
    });

    const validationResult = userUpdateSchema.safeParse(req.body);
    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      }));
      return sendError(res, 'Validation failed', 400, 'VALIDATION_ERROR', { details: errorMessages });
    }

    const updateData = validationResult.data;

    if (updateData.isAdmin !== undefined && !user.isAdmin) {
      delete updateData.isAdmin;
    }

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

    const updatedUser = await storage.updateUser(userId, updateData);

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
              console.log('[User] Synced profile changes to bowler record:', bowler.id);
            }

            if (updatedUser.email && (emailChanged || nameChanged || phoneChanged)) {
              const squareCustomer = await createOrUpdateCustomer(
                updatedUser.name,
                updatedUser.email,
                updatedUser.phone
              );
              if (squareCustomer && squareCustomer.id !== bowler.squareCustomerId) {
                await storage.updateBowler(bowler.id, {
                  ...bowler,
                  ...bowlerUpdate,
                  squareCustomerId: squareCustomer.id,
                });
                console.log('[User] Linked Square customer to bowler:', squareCustomer.id);
              }
            }
          }
        } catch (syncError) {
          console.error('[User] Error syncing to bowler/Square (non-fatal):', syncError);
        }
      }
    }

    return sendSuccess(res, { ...updatedUser, password: undefined });
  } catch (error) {
    console.error('[User] Error updating user:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    const schema = z.object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: z.string().min(6, 'New password must be at least 6 characters'),
    });

    const validationResult = schema.safeParse(req.body);
    if (!validationResult.success) {
      const msg = validationResult.error.errors.map(e => e.message).join(', ');
      return sendError(res, msg, 400, 'VALIDATION_ERROR');
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
    console.error('[User] Error changing password:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

export default router;