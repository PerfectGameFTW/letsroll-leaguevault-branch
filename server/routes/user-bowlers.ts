import { Router } from 'express';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api';
import { z } from 'zod';

const router = Router();

// Middleware to ensure user is authenticated
function requireAuth(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
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
    const { bowlerId } = linkBowlerSchema.parse(req.body);
    
    // Verify bowler exists
    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return sendError(res, 'Bowler not found', 404, 'NOT_FOUND');
    }
    
    // Link bowler to user
    const updatedUser = await storage.linkUserToBowler(req.user.id, bowlerId);
    sendSuccess(res, updatedUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to link bowler to user');
    }
  }
});

// Get the bowler associated with the authenticated user
router.get('/bowler', requireAuth, async (req, res) => {
  try {
    if (!req.user.bowlerId) {
      return sendSuccess(res, null);
    }
    
    const bowler = await storage.getBowler(req.user.bowlerId);
    sendSuccess(res, bowler);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowler');
  }
});

// Unlink bowler from user
router.delete('/unlink-bowler', requireAuth, async (req, res) => {
  try {
    await storage.linkUserToBowler(req.user.id, null);
    sendSuccess(res, { message: 'Bowler unlinked successfully' });
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to unlink bowler');
  }
});

export default router;
