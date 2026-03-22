import { Router } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError, handleZodError } from '../utils/api';
import { z } from 'zod';
import { User as SelectUser } from '@shared/schema';
import { hasAccessToBowler } from '../utils/access-control.js';

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
  }
  const user = req.user as SelectUser;
  if (!user) {
    return sendError(res, 'Invalid session', 401, 'INVALID_SESSION');
  }
  next();
}

// Schema for linking bowler to user
const linkBowlerSchema = z.object({
  bowlerId: z.number().int().positive('Bowler ID must be a positive number'),
});

// Link a bowler to the authenticated user
router.post('/link-bowler', requireAuth, async (req, res) => {
  try {
    const user = req.user as SelectUser;
    const { bowlerId } = linkBowlerSchema.parse(req.body);

    // Verify bowler exists
    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return sendError(res, 'Bowler not found', 404, 'NOT_FOUND');
    }

    // Check if user has access to this bowler based on organization
    if (!(await hasAccessToBowler(req, bowlerId))) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    // Link bowler to user
    const updatedUser = await storage.linkUserToBowler(user.id, bowlerId);
    sendSuccess(res, updatedUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    sendError(res, error instanceof Error ? error.message : 'Failed to link bowler to user');
  }
});

// Get the bowler associated with the authenticated user
router.get('/bowler', requireAuth, async (req, res) => {
  try {
    const user = req.user as SelectUser;
    if (!user.bowlerId) {
      return sendSuccess(res, null);
    }

    const bowler = await storage.getBowler(user.bowlerId);
    
    // Verify the user still has access to this bowler 
    // (in case organization access changed after linking)
    if (bowler && !(await hasAccessToBowler(req, bowler.id))) {
      // If the user no longer has access, unlink the bowler
      await storage.linkUserToBowler(user.id, undefined);
      return sendError(res, "You no longer have access to this bowler", 403, 'FORBIDDEN');
    }
    
    sendSuccess(res, bowler);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowler');
  }
});

// Unlink bowler from user
router.delete('/unlink-bowler', requireAuth, async (req, res) => {
  try {
    const user = req.user as SelectUser;
    
    // If the user has a linked bowler, verify they still have access
    if (user.bowlerId && !(await hasAccessToBowler(req, user.bowlerId))) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }
    
    // Update the user's bowlerId to undefined instead of null
    await storage.linkUserToBowler(user.id, undefined);
    sendSuccess(res, { message: 'Bowler unlinked successfully' });
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to unlink bowler');
  }
});

export default router;