import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendSuccess, sendError, sanitizeUser } from '../utils/api.js';
import { storage } from '../storage.js';
import { requireAdmin } from '../middleware/admin.js';

/**
 * This route handles system administrator management
 * System admins have both is_admin=true and is_organization_admin=true
 * This provides them access to all pages and functions in the application
 */
const router = Router();

// Create a new system admin (requires existing admin authentication)
router.post('/create/:id', requireAdmin, async (req: Request, res: Response) => {
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

    // Check if the user is already a system admin
    if (user.isAdmin && user.isOrganizationAdmin) {
      return sendError(
        res,
        'User is already a system admin',
        400,
        'ALREADY_SYSTEM_ADMIN'
      );
    }
    
    // Update user to be a system admin by setting both flags
    const updatedUser = await storage.updateUserAdminStatus(userId, true);
    
    try {
      // Also make them an organization admin if they have an organization
      if (user.organizationId) {
        await storage.updateUserOrganizationAdminStatus(userId, true);
      } else {
        // For users without an organization, we'll update directly in the database
        // since the storage method requires an organization
        const { db } = await import('../db.js');
        const { users } = await import('../../shared/schema.js');
        const { eq } = await import('drizzle-orm');
        
        await db.update(users)
          .set({ isOrganizationAdmin: true })
          .where(eq(users.id, userId));
          
      }
      

      // Return the updated user without password
      sendSuccess(
        res,
        { 
          ...sanitizeUser(updatedUser),
          isOrganizationAdmin: true
        }
      );
    } catch (error) {
      console.error('[System Admin] Error updating organization admin status:', error);
      sendError(
        res,
        'Failed to update organization admin status',
        500,
        'ORG_ADMIN_UPDATE_ERROR'
      );
    }
  } catch (error) {
    console.error('[System Admin] Error creating system admin:', error);
    sendError(
      res,
      'Failed to create system admin',
      500,
      'SERVER_ERROR'
    );
  }
});

// Get all system admins (requires admin authentication)
router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await storage.getUsers();
    
    // Filter to only include system admins (users with both admin flags set to true)
    const systemAdmins = users.filter(user => user.isAdmin && user.isOrganizationAdmin);
    
    // Return the list of system admins without passwords
    sendSuccess(
      res,
      systemAdmins.map(sanitizeUser)
    );
  } catch (error) {
    console.error('[System Admin] Error fetching system admins:', error);
    sendError(
      res,
      'Failed to fetch system admins',
      500,
      'SERVER_ERROR'
    );
  }
});

// Remove system admin privileges (requires admin authentication)
router.post('/revoke/:id', requireAdmin, async (req: Request, res: Response) => {
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

    // Don't allow revoking the last system admin
    const users = await storage.getUsers();
    const systemAdmins = users.filter(u => u.isAdmin && u.isOrganizationAdmin);
    
    if (systemAdmins.length <= 1 && systemAdmins.some(admin => admin.id === userId)) {
      return sendError(
        res,
        'Cannot revoke the last system admin',
        400,
        'LAST_SYSTEM_ADMIN'
      );
    }

    // Check if the current user is trying to revoke their own system admin access
    if (req.user?.id === userId) {
      return sendError(
        res,
        'Cannot revoke your own system admin access',
        400,
        'SELF_REVOKE_NOT_ALLOWED'
      );
    }
    
    try {
      // Update user to remove system admin privileges
      // We'll keep them as a regular admin but remove organization admin status
      let updatedUser;
      
      if (user.organizationId) {
        updatedUser = await storage.updateUserOrganizationAdminStatus(userId, false);
      } else {
        // For users without an organization, we'll update directly in the database
        const { db } = await import('../db.js');
        const { users } = await import('../../shared/schema.js');
        const { eq } = await import('drizzle-orm');
        
        await db.update(users)
          .set({ isOrganizationAdmin: false })
          .where(eq(users.id, userId));
          
        
        // Re-fetch the user to get updated info
        updatedUser = await storage.getUser(userId);
      }
      

      // Return the updated user without password
      sendSuccess(
        res,
        sanitizeUser(updatedUser!)
      );
    } catch (error) {
      console.error('[System Admin] Error revoking organization admin status:', error);
      sendError(
        res,
        'Failed to revoke organization admin status',
        500,
        'ORG_ADMIN_REVOKE_ERROR'
      );
    }
  } catch (error) {
    console.error('[System Admin] Error revoking system admin:', error);
    sendError(
      res,
      'Failed to revoke system admin privileges',
      500,
      'SERVER_ERROR'
    );
  }
});

export default router;