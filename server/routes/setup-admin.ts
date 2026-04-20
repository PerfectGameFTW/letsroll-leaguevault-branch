import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendSuccess, sendError, sanitizeUser, handleZodError } from '../utils/api.js';
import { storage } from '../storage';
import { hashPassword, safeTokenCompare } from '../auth.js';
import { passwordSchema } from '@shared/password-validation.js';
import { env } from '../config';
import { createLogger } from '../logger';
import { setupAdminLimiter } from '../middleware/rate-limit.js';

const log = createLogger("SetupAdmin");

const router = Router();

// Endpoint to create the first admin user
// This can only be used if there are no admin users in the system
// Requires a SETUP_SECRET header matching the SETUP_SECRET environment variable
router.post('/create-first-admin', setupAdminLimiter, async (req: Request, res: Response) => {
  try {
    const setupSecret = env.SETUP_SECRET;
    if (!setupSecret) {
      return sendError(res, 'This endpoint is disabled. Set SETUP_SECRET to enable it.', 403, 'ENDPOINT_DISABLED');
    }
    const providedSecret = req.headers['x-setup-secret'];
    if (!providedSecret || !safeTokenCompare(providedSecret, setupSecret)) {
      return sendError(res, 'Invalid or missing setup secret.', 401, 'UNAUTHORIZED');
    }

    // Check if there are existing admin users
    const users = await storage.getUsers();
    const adminUsers = users.filter(user => user.role === 'system_admin');
    
    if (adminUsers.length > 0) {
      return sendError(
        res, 
        'Admin users already exist. Use the regular admin invitation process.',
        403,
        'ADMIN_EXISTS'
      );
    }

    // Define schema for admin user data
    const adminSchema = z.object({
      email: z.string().email('Invalid email address'),
      password: passwordSchema,
      name: z.string().min(2, 'Name must be at least 2 characters'),
      phone: z.string().optional(),
    });

    // Validate request data
    const validationResult = adminSchema.safeParse(req.body);
    if (!validationResult.success) {
      return handleZodError(res, validationResult.error);
    }

    const userData = validationResult.data;
    
    // Check if user with this email already exists
    const existingUser = await storage.getUserByEmail(userData.email);
    if (existingUser) {
      return sendError(
        res,
        'A user with this email already exists',
        409,
        'EMAIL_EXISTS'
      );
    }

    // Hash the password
    const hashedPassword = await hashPassword(userData.password);

    // Create the admin user
    const newAdminUser = await storage.createUser({
      email: userData.email,
      password: hashedPassword,
      name: userData.name,
      phone: userData.phone ?? undefined,
      role: 'system_admin',
      organizationId: null
    });


    // Return the created user without password
    sendSuccess(
      res,
      sanitizeUser(newAdminUser),
      201
    );
  } catch (error) {
    log.error('Error creating first admin user:', error);
    sendError(
      res,
      'Failed to create admin user',
      500,
      'SERVER_ERROR'
    );
  }
});

// Promote an existing user to system_admin — only works when ZERO admin users exist.
// Same setup-secret guard as create-first-admin. Useful when bootstrapping
// from a database that was seeded with regular users first.
router.post('/first-system-admin/:id', setupAdminLimiter, async (req: Request, res: Response) => {
  try {
    const setupSecret = env.SETUP_SECRET;
    if (!setupSecret) {
      return sendError(res, 'This endpoint is disabled. Set SETUP_SECRET to enable it.', 403, 'ENDPOINT_DISABLED');
    }
    const rawSecret = req.headers['x-setup-secret'];
    const providedSecret = Array.isArray(rawSecret) ? rawSecret[0] : rawSecret;
    if (!providedSecret || !safeTokenCompare(providedSecret, setupSecret)) {
      return sendError(res, 'Invalid or missing setup secret.', 401, 'UNAUTHORIZED');
    }

    const adminExists = await storage.hasAdminUsers();
    if (adminExists) {
      return sendError(
        res,
        'Admin users already exist. Use the regular admin invitation process.',
        403,
        'ADMIN_EXISTS',
      );
    }

    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'INVALID_ID');
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }

    const updatedUser = await storage.updateUserRole(userId, 'system_admin');
    sendSuccess(res, sanitizeUser(updatedUser));
  } catch (error) {
    log.error('Error creating first system admin:', error);
    sendError(res, 'Failed to create first system admin', 500, 'SERVER_ERROR');
  }
});

export default router;