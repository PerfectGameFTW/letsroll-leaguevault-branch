import { Router, Request, Response } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';
import { z } from 'zod';
import { User as SelectUser, updateEmailTemplateSchema } from '@shared/schema';
import { requireAdmin } from '../middleware/admin';
import { sendTestEmail } from '../services/email';

const router = Router();

// Schema for making a user an admin
const setAdminStatusSchema = z.object({
  userId: z.number().int().positive('User ID must be a positive number'),
  makeSystemAdmin: z.boolean()
});

// Get all users (admin only)
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await storage.getUsers();
    sendSuccess(res, users.map(({ password, ...u }) => u));
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
      makeSystemAdmin: req.body.isAdmin ?? req.body.makeSystemAdmin
    });

    const requestingUser = req.user as SelectUser;
    if (requestingUser.id === parsedData.userId) {
      console.error('[Admin Routes] User attempted to change their own admin status');
      return sendError(res, 'Cannot modify your own admin status', 403, 'SELF_MODIFICATION_DENIED');
    }
    
    const newRole = parsedData.makeSystemAdmin ? 'system_admin' : 'user';
    const updatedUser = await storage.updateUserRole(parsedData.userId, newRole);
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

    sendSuccess(res, stats);
  } catch (error) {
    console.error('[Admin Routes] Error fetching admin dashboard stats:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch admin dashboard stats');
  }
});

router.get('/email-templates', requireAdmin, async (req, res) => {
  try {
    const templates = await storage.getEmailTemplates();
    sendSuccess(res, templates);
  } catch (error) {
    console.error('[Admin Routes] Error fetching email templates:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch email templates');
  }
});

router.get('/email-templates/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid template ID', 400, 'InvalidRequest');
    }
    const template = await storage.getEmailTemplate(id);
    if (!template) {
      return sendError(res, 'Email template not found', 404, 'NotFound');
    }
    sendSuccess(res, template);
  } catch (error) {
    console.error('[Admin Routes] Error fetching email template:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch email template');
  }
});

router.patch('/email-templates/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid template ID', 400, 'InvalidRequest');
    }
    const existing = await storage.getEmailTemplate(id);
    if (!existing) {
      return sendError(res, 'Email template not found', 404, 'NotFound');
    }
    const validated = updateEmailTemplateSchema.parse(req.body);
    const updated = await storage.updateEmailTemplate(id, validated);
    sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 'Invalid template data', 400, 'ValidationError');
    }
    console.error('[Admin Routes] Error updating email template:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to update email template');
  }
});

router.post('/email-templates/:id/send-test', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid template ID', 400, 'InvalidRequest');
    }
    const { toEmail, organizationId } = req.body;
    if (!toEmail || typeof toEmail !== 'string') {
      return sendError(res, 'Email address is required', 400, 'InvalidRequest');
    }
    const template = await storage.getEmailTemplate(id);
    if (!template) {
      return sendError(res, 'Email template not found', 404, 'NotFound');
    }
    let organization = undefined;
    if (organizationId) {
      organization = await storage.getOrganization(parseInt(organizationId, 10));
    }
    const success = await sendTestEmail(template, toEmail, organization);
    if (success) {
      sendSuccess(res, { message: `Test email sent to ${toEmail}` });
    } else {
      sendError(res, 'Failed to send test email. Check SendGrid configuration.', 500, 'SendFailed');
    }
  } catch (error) {
    console.error('[Admin Routes] Error sending test email:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to send test email');
  }
});

export default router;