import { Router, Request, Response } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';
import { z } from 'zod';
import { User as SelectUser } from '@shared/schema';
import { requireAdmin } from '../middleware/admin';

const router = Router();

// Schema for making a user an admin
const setAdminStatusSchema = z.object({
  userId: z.number().int().positive('User ID must be a positive number'),
  isAdmin: z.boolean()
});

// Get all users (admin only)
router.get('/users', requireAdmin, async (req, res) => {
  try {
    console.log('[Admin Routes] Fetching all users');
    const users = await storage.getUsers();
    console.log(`[Admin Routes] Found ${users.length} users`);
    sendSuccess(res, users);
  } catch (error) {
    console.error('[Admin Routes] Error fetching users:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch users');
  }
});

// Make a user an admin (admin only)
router.patch('/users/:userId/admin-status', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const parsedData = setAdminStatusSchema.parse({ 
      userId: parseInt(userId), 
      isAdmin: req.body.isAdmin 
    });
    
    console.log('[Admin Routes] Updating admin status:', {
      userId: parsedData.userId,
      isAdmin: parsedData.isAdmin
    });
    
    // Make sure the user isn't toggling their own admin status
    const requestingUser = req.user as SelectUser;
    if (requestingUser.id === parsedData.userId) {
      console.error('[Admin Routes] User attempted to change their own admin status');
      return sendError(res, 'Cannot modify your own admin status', 403, 'SELF_MODIFICATION_DENIED');
    }
    
    const updatedUser = await storage.updateUserAdminStatus(parsedData.userId, parsedData.isAdmin);
    console.log('[Admin Routes] Successfully updated admin status for user:', {
      userId: updatedUser.id,
      isAdmin: updatedUser.isAdmin
    });
    
    sendSuccess(res, updatedUser);
  } catch (error) {
    console.error('[Admin Routes] Error updating admin status:', error);
    if (error instanceof z.ZodError) {
      // Convert Zod validation error to a readable format
      const validationErrors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
      sendError(res, validationErrors, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update admin status');
    }
  }
});

// Get admin dashboard stats (admin only)
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    console.log('[Admin Routes] Fetching admin dashboard stats');
    
    // Fetch data for dashboard
    const [bowlers, leagues, teams, payments] = await Promise.all([
      storage.getBowlers(),
      storage.getLeagues(),
      storage.getTeams(),
      storage.getPayments()
    ]);
    
    // Get recent payments (last 5)
    const recentPayments = payments
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
    
    // Calculate count of active entities
    const activeBowlers = bowlers.filter(b => b.active).length;
    const activeLeagues = leagues.filter(l => l.active).length;
    const activeTeams = teams.filter(t => t.active).length;
    
    // Count payments by status
    const paidPayments = payments.filter(p => p.status === 'paid').length;
    const pendingPayments = payments.filter(p => p.status === 'pending').length;
    
    // Calculate total paid
    const totalAmountPaid = payments
      .filter(p => p.status === 'paid')
      .reduce((sum, p) => sum + p.amount, 0);
    
    const stats = {
      bowlers: {
        total: bowlers.length,
        active: activeBowlers
      },
      leagues: {
        total: leagues.length,
        active: activeLeagues
      },
      teams: {
        total: teams.length,
        active: activeTeams
      },
      payments: {
        total: payments.length,
        paid: paidPayments,
        pending: pendingPayments,
        totalAmountPaid
      },
      recentPayments
    };

    console.log('[Admin Routes] Dashboard stats:', {
      bowlersCount: bowlers.length,
      leaguesCount: leagues.length,
      teamsCount: teams.length,
      paymentsCount: payments.length,
      recentPaymentsCount: recentPayments.length
    });
    
    sendSuccess(res, stats);
  } catch (error) {
    console.error('[Admin Routes] Error fetching admin dashboard stats:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch admin dashboard stats');
  }
});

export default router;