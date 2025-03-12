import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/api.js';

/**
 * Middleware to check if the user is an admin
 * This should be used after the requireAuth middleware
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // Check if user is authenticated
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return sendError(
      res,
      'Authentication required',
      401,
      'AUTH_REQUIRED'
    );
  }

  // Check if authenticated user is an admin
  if (!(req.user as any).isAdmin) {
    return sendError(
      res,
      'Admin access required',
      403,
      'ADMIN_REQUIRED'
    );
  }

  // User is an admin, proceed
  next();
}