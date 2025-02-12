import { Router } from 'express';
import { storage } from '../storage';
import { insertPaymentSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

// Debug middleware at router level
router.use((req, res, next) => {
  console.log('[Payments Router] Request received:', {
    method: req.method,
    path: req.path,
    url: req.url,
    params: req.params
  });
  next();
});

router.get("/", async (req, res) => {
  try {
    const bowlerId = req.query.bowlerId ? parseInt(req.query.bowlerId as string) : undefined;
    const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
    const payments = await storage.getPayments(bowlerId, leagueId);
    sendSuccess(res, payments);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch payments');
  }
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  console.log('[Payments Router] DELETE route hit with ID:', id);
  
  try {
    if (isNaN(id)) {
      console.error('[Payments Router] Invalid ID:', req.params.id);
      return sendError(res, "Invalid payment ID", 400);
    }

    console.log('[Payments Router] Before storage.deletePayment call');
    const result = await storage.deletePayment(id);
    console.log('[Payments Router] After storage.deletePayment call. Result:', result);
    
    if (!result) {
      console.log('[Payments Router] Payment not found');
      return sendError(res, "Payment not found", 404);
    }
    
    console.log('[Payments Router] Payment deleted successfully');
    return sendSuccess(res, { success: true, id });
  } catch (error) {
    console.error('[Payments Router] Delete error:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to delete payment');
  }
});

router.post("/", async (req, res) => {
  try {
    const payment = insertPaymentSchema.parse(req.body);
    const created = await storage.createPayment(payment);
    sendSuccess(res, created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create payment');
    }
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, squarePaymentId } = z.object({
      status: z.string(),
      squarePaymentId: z.string().optional(),
    }).parse(req.body);

    const updated = await storage.updatePaymentStatus(id, status, squarePaymentId);
    sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update payment status');
    }
  }
});


export default router;