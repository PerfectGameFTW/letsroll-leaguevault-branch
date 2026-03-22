import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { sendSuccess, sendError, sanitizeUser } from '../utils/api.js';
import { storage } from '../storage';
import { requireAdmin } from '../middleware/admin.js';

const router = Router();

router.post('/create/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'INVALID_ID');
    }
    
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }

    if (user.role === 'system_admin') {
      return sendError(res, 'User is already a system admin', 400, 'ALREADY_SYSTEM_ADMIN');
    }
    
    const updatedUser = await storage.updateUserRole(userId, 'system_admin');
    sendSuccess(res, sanitizeUser(updatedUser));
  } catch (error) {
    console.error('[System Admin] Error creating system admin:', error);
    sendError(res, 'Failed to create system admin', 500, 'SERVER_ERROR');
  }
});

router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await storage.getUsers();
    const systemAdmins = users.filter(user => user.role === 'system_admin');
    sendSuccess(res, systemAdmins.map(sanitizeUser));
  } catch (error) {
    console.error('[System Admin] Error fetching system admins:', error);
    sendError(res, 'Failed to fetch system admins', 500, 'SERVER_ERROR');
  }
});

router.post('/revoke/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'INVALID_ID');
    }
    
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }

    const users = await storage.getUsers();
    const systemAdmins = users.filter(u => u.role === 'system_admin');
    
    if (systemAdmins.length <= 1 && systemAdmins.some(admin => admin.id === userId)) {
      return sendError(res, 'Cannot revoke the last system admin', 400, 'LAST_SYSTEM_ADMIN');
    }

    if (req.user?.id === userId) {
      return sendError(res, 'Cannot revoke your own system admin access', 400, 'SELF_REVOKE_NOT_ALLOWED');
    }
    
    const updatedUser = await storage.updateUserRole(userId, 'user');
    sendSuccess(res, sanitizeUser(updatedUser));
  } catch (error) {
    console.error('[System Admin] Error revoking system admin:', error);
    sendError(res, 'Failed to revoke system admin privileges', 500, 'SERVER_ERROR');
  }
});

export default router;
