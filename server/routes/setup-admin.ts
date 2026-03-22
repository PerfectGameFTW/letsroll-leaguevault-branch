import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendSuccess, sendError, sanitizeUser } from '../utils/api.js';
import { storage } from '../storage';
import { hashPassword } from '../auth.js';
import { passwordSchema } from '@shared/password-validation.js';
import { env } from '../config';

const router = Router();

// Endpoint to create the first admin user
// This can only be used if there are no admin users in the system
// Requires a SETUP_SECRET header matching the SETUP_SECRET environment variable
router.post('/create-first-admin', async (req: Request, res: Response) => {
  try {
    const setupSecret = env.SETUP_SECRET;
    if (!setupSecret) {
      return sendError(res, 'This endpoint is disabled. Set SETUP_SECRET to enable it.', 403, 'ENDPOINT_DISABLED');
    }
    const providedSecret = req.headers['x-setup-secret'];
    if (!providedSecret || providedSecret !== setupSecret) {
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
    console.error('[Setup] Error creating first admin user:', error);
    sendError(
      res,
      'Failed to create admin user',
      500,
      'SERVER_ERROR'
    );
  }
});

export default router;