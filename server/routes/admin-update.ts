import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendSuccess, sendError } from '../utils/api.js';
import { storage } from '../storage.js';
import { requireAdmin } from '../middleware/admin.js';

const router = Router();

// Endpoint to update a user's admin status
// This requires admin authentication
router.patch('/users/:id/admin-status', requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(
        res,
        'Invalid user ID',
        400,
        'INVALID_ID'
      );
    }

    // Define schema for admin status update
    const adminStatusSchema = z.object({
      isAdmin: z.boolean()
    });

    // Validate request data
    const validationResult = adminStatusSchema.safeParse(req.body);
    if (!validationResult.success) {
      const errorMessages = validationResult.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      }));
      
      return sendError(
        res,
        'Validation failed',
        400,
        'VALIDATION_ERROR',
        { details: errorMessages }
      );
    }

    const { isAdmin } = validationResult.data;
    
    // Check if user exists
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(
        res,
        'User not found',
        404,
        'USER_NOT_FOUND'
      );
    }

    // Update the user's admin status
    const updatedUser = await storage.updateUserAdminStatus(userId, isAdmin);


    // Return the updated user without password
    sendSuccess(
      res,
      { ...updatedUser, password: undefined }
    );
  } catch (error) {
    console.error('[Admin] Error updating user admin status:', error);
    sendError(
      res,
      'Failed to update user admin status',
      500,
      'SERVER_ERROR'
    );
  }
});

// Endpoint to make a registered user the first system admin
// This can only work if ZERO admin users exist in the system
// Requires a SETUP_SECRET header matching the SETUP_SECRET environment variable
router.post('/first-system-admin/:id', async (req: Request, res: Response) => {
  try {
    const setupSecret = process.env.SETUP_SECRET;
    if (!setupSecret) {
      return sendError(res, 'This endpoint is disabled. Set SETUP_SECRET to enable it.', 403, 'ENDPOINT_DISABLED');
    }
    const providedSecret = req.headers['x-setup-secret'];
    if (!providedSecret || providedSecret !== setupSecret) {
      return sendError(res, 'Invalid or missing setup secret.', 401, 'UNAUTHORIZED');
    }

    // Check if there are existing admin users
    const users = await storage.getUsers();
    const adminUsers = users.filter(user => user.isAdmin);
    
    if (adminUsers.length > 0) {
      return sendError(
        res,
        'Admin users already exist. Use the regular admin invitation process.',
        403,
        'ADMIN_EXISTS'
      );
    }

    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(
        res,
        'Invalid user ID',
        400,
        'INVALID_ID'
      );
    }
    
    // Check if user exists
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(
        res,
        'User not found',
        404,
        'USER_NOT_FOUND'
      );
    }

    // Update the user's admin status
    const updatedUser = await storage.updateUserAdminStatus(userId, true);


    // Return the updated user without password
    sendSuccess(
      res,
      { ...updatedUser, password: undefined }
    );
  } catch (error) {
    console.error('[Admin] Error creating first system admin:', error);
    sendError(
      res,
      'Failed to create first system admin',
      500,
      'SERVER_ERROR'
    );
  }
});

export default router;