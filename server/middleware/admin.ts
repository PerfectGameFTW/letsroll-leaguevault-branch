import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to check if the user is an admin
 * This should be used after the requireAuth middleware
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // The user should be attached to the request by the authentication middleware
  const user = req.user;
  
  if (!user) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'not_authenticated',
        message: 'You must be logged in to access this resource'
      }
    });
  }

  // Check if the user has admin privileges
  if (!user.isAdmin) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'not_authorized',
        message: 'You do not have permission to access this resource'
      }
    });
  }

  // User is an admin, proceed to the next middleware or route handler
  next();
}