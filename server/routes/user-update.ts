import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendError, sendSuccess } from '../utils/api';
import { storage } from '../storage';

// Custom middleware to ensure user is authenticated
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return sendError(
      res,
      'Authentication required',
      401,
      'AUTH_REQUIRED'
    );
  }
  next();
}

const router = Router();

// Update user profile (name, email)
router.patch('/profile/:id', requireAuth, async (req: Request, res: Response) => {
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

    // Check if user is modifying their own profile or is an admin
    const user = req.user as any;
    if (user.id !== userId && !user.isAdmin) {
      return sendError(
        res,
        'Unauthorized',
        403,
        'UNAUTHORIZED'
      );
    }

    // Define schema for user update
    const userUpdateSchema = z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      isAdmin: z.boolean().optional() // Only admins can update this field
    });

    // Validate request data
    const validationResult = userUpdateSchema.safeParse(req.body);
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

    const updateData = validationResult.data;
    
    // Only allow admin users to update the isAdmin field
    if (updateData.isAdmin !== undefined && !user.isAdmin) {
      delete updateData.isAdmin;
    }

    // Check if user exists
    const existingUser = await storage.getUser(userId);
    if (!existingUser) {
      return sendError(
        res,
        'User not found',
        404,
        'USER_NOT_FOUND'
      );
    }

    // Check if email is being changed and already exists
    if (updateData.email && updateData.email !== existingUser.email) {
      const userWithEmail = await storage.getUserByEmail(updateData.email);
      if (userWithEmail && userWithEmail.id !== userId) {
        return sendError(
          res,
          'Email already in use',
          400,
          'EMAIL_IN_USE'
        );
      }
    }

    // Update the user
    const updatedUser = await storage.updateUser(userId, updateData);
    
    console.log(`[User] User ID ${userId} updated by ${user.id}`);

    return sendSuccess(res, { ...updatedUser, password: undefined });
  } catch (error) {
    console.error('[User] Error updating user:', error);
    return sendError(
      res,
      'Internal server error',
      500,
      'SERVER_ERROR',
      { details: error instanceof Error ? error.message : undefined }
    );
  }
});

export default router;