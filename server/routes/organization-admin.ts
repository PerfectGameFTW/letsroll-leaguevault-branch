import { Router, Request, Response } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';
import { z } from 'zod';

// Define error code type for type safety
type ErrorCode = string;

const router = Router();

// Middleware to check if the user is an organization admin or a system admin
async function requireOrgAdminOrSystemAdmin(req: any, res: Response, next: any) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ success: false, error: { code: 'unauthorized', message: 'You must be logged in to access this resource' } });
  }

  // Allow system admins
  if (req.user.isAdmin) {
    return next();
  }

  // Check if user is an organization admin
  if (req.user.isOrganizationAdmin && req.user.organizationId) {
    return next();
  }

  return res.status(403).json({ success: false, error: { code: 'forbidden', message: 'You do not have permission to access this resource' } });
}

// Get all users in the current user's organization
router.get('/users', requireOrgAdminOrSystemAdmin, async (req: any, res: Response) => {
  try {
    // A system admin can specify any organization
    let organizationId: number | null = req.query.organizationId 
      ? parseInt(String(req.query.organizationId), 10) 
      : null;
    
    // For organization admins, force their own organization
    if (!req.user.isAdmin && req.user.isOrganizationAdmin) {
      organizationId = req.user.organizationId;
    }
    
    if (!organizationId) {
      return sendError(res, 'bad_request', 'Organization ID is required', 400);
    }
    
    const users = await storage.getOrganizationUsers(organizationId);
    
    return sendSuccess(res, users);
  } catch (error) {
    console.error('[Org Admin Route] Error getting organization users:', error);
    return sendError(res, 'internal_error', 'Failed to get organization users', 500);
  }
});

// Update a user's organization admin status
router.patch('/users/:id/admin-status', requireOrgAdminOrSystemAdmin, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'bad_request', 'Invalid user ID', 400);
    }
    
    // Validate request body
    const schema = z.object({
      isOrganizationAdmin: z.boolean(),
    });
    
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, 'validation_error', parseResult.error.message, 400);
    }
    
    const { isOrganizationAdmin } = parseResult.data;
    
    // Get the user to check organization
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'not_found', 'User not found', 404);
    }
    
    // Organization admins can only update users in their own organization
    if (!req.user.isAdmin && req.user.isOrganizationAdmin) {
      if (user.organizationId !== req.user.organizationId) {
        return sendError(res, 'forbidden', 'You can only update users in your own organization', 403);
      }
    }
    
    // Update user's organization admin status
    const updatedUser = await storage.updateUserOrganizationAdminStatus(userId, isOrganizationAdmin);
    return sendSuccess(res, updatedUser);
  } catch (error) {
    console.error('[Org Admin Route] Error updating organization admin status:', error);
    return sendError(res, 'internal_error', 'Failed to update organization admin status', 500);
  }
});

// Add a user to the organization
router.post('/users/:id/add', requireOrgAdminOrSystemAdmin, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'bad_request', 'Invalid user ID', 400);
    }
    
    // Validate request body
    const schema = z.object({
      organizationId: z.number().optional(),
      isOrganizationAdmin: z.boolean().optional().default(false),
    });
    
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, 'validation_error', parseResult.error.message, 400);
    }
    
    const { isOrganizationAdmin } = parseResult.data;
    
    // Get the organization ID (for org admins, it must be their own org)
    let organizationId: number;
    
    // System admins can specify any org ID
    if (req.user.isAdmin && req.body.organizationId !== undefined) {
      organizationId = parseInt(String(req.body.organizationId), 10);
      if (isNaN(organizationId)) {
        return sendError(res, 'bad_request', 'Invalid organization ID', 400);
      }
    } else {
      // Organization admins must use their own organization
      organizationId = req.user.organizationId;
    }
    
    if (!organizationId) {
      return sendError(res, 'bad_request', 'Organization ID is required', 400);
    }
    
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'not_found', 'User not found', 404);
    }

    // Check if user is already in an organization
    if (user.organizationId) {
      // If they're in the same org we're trying to add them to, just update admin status
      if (user.organizationId === organizationId) {
        
        // Update org admin status if needed
        if (isOrganizationAdmin !== user.isOrganizationAdmin) {
          const updatedUser = await storage.updateUserOrganizationAdminStatus(userId, isOrganizationAdmin);
          return sendSuccess(res, updatedUser);
        }
        
        return sendSuccess(res, user);
      }
      
      return sendError(res, 'conflict', 'User is already in another organization', 409);
    }
    
    // Use setUserOrganization to set the user's organization
    const updatedUser = await storage.setUserOrganization(userId, organizationId);
    
    // If requested to make user an org admin and they aren't already
    if (isOrganizationAdmin && !updatedUser.isOrganizationAdmin) {
      await storage.updateUserOrganizationAdminStatus(userId, true);
    }
    
    // Get fresh user data
    const refreshedUser = await storage.getUser(userId);
    return sendSuccess(res, refreshedUser);
  } catch (error) {
    console.error('[Org Admin Route] Error adding user to organization:', error);
    return sendError(res, 'internal_error', 'Failed to add user to organization', 500);
  }
});

// Remove a user from the organization
router.delete('/users/:id/remove', requireOrgAdminOrSystemAdmin, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'bad_request', 'Invalid user ID', 400);
    }
    
    // Get the user
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'not_found', 'User not found', 404);
    }
    
    // Organization admins can only remove users from their own organization
    if (!req.user.isAdmin && req.user.isOrganizationAdmin) {
      if (user.organizationId !== req.user.organizationId) {
        return sendError(res, 'forbidden', 'You can only remove users from your own organization', 403);
      }
      
      // Org admins cannot remove themselves
      if (user.id === req.user.id) {
        return sendError(res, 'forbidden', 'You cannot remove yourself from the organization', 403);
      }
    }
    
    // Check if user is in an organization
    if (!user.organizationId) {
      return sendError(res, 'bad_request', 'User is not in any organization', 400);
    }
    
    // Remove user from organization
    const updatedUser = await storage.setUserOrganization(userId, null);
    return sendSuccess(res, updatedUser);
  } catch (error) {
    console.error('[Org Admin Route] Error removing user from organization:', error);
    return sendError(res, 'internal_error', 'Failed to remove user from organization', 500);
  }
});

// Update a user's location assignment
router.patch('/users/:id/location', requireOrgAdminOrSystemAdmin, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'bad_request', 'Invalid user ID', 400);
    }

    const schema = z.object({
      locationId: z.number().int().positive().nullable(),
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, 'validation_error', parseResult.error.message, 400);
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'not_found', 'User not found', 404);
    }

    if (!req.user.isAdmin && req.user.isOrganizationAdmin) {
      if (user.organizationId !== req.user.organizationId) {
        return sendError(res, 'forbidden', 'You can only update users in your own organization', 403);
      }
    }

    const updatedUser = await storage.setUserLocation(userId, parseResult.data.locationId);
    return sendSuccess(res, updatedUser);
  } catch (error) {
    console.error('[Org Admin Route] Error updating user location:', error);
    return sendError(res, 'internal_error', 'Failed to update user location', 500);
  }
});

export default router;