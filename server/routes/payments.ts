import { Router } from 'express';
import { storage } from '../storage';
import { insertPaymentSchema, payments } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';
import { processPayment } from '../services/square';
import { db } from '../db';
import { sql, eq } from 'drizzle-orm';

const router = Router();
console.log('[Payments Router] Initializing routes');

// Add debug middleware at the router level
router.use((req, res, next) => {
  console.log('[Payments Router] Incoming request:', {
    method: req.method,
    path: req.path,
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
  console.log('[DEBUG] Route hit:', {
    path: req.path,
    params: req.params,
    method: req.method
  });
  console.log('[API] DELETE route handler entered for payment:', req.params.id, typeof req.params.id);
  try {
    const id = parseInt(req.params.id);
    console.log('[API] Parsed ID:', id, typeof id);

    if (isNaN(id)) {
      console.error('[API] Invalid payment ID:', req.params.id);
      return sendError(res, "Invalid payment ID", 400);
    }

    console.log('[API] Attempting to delete payment:', id);
    console.log('[API] Calling storage.deletePayment...');
    const result = await storage.deletePayment(id);
    console.log('[API] Delete operation detailed result:', {
      success: result,
      resultType: typeof result,
      id: id,
      idType: typeof id
    });

    if (!result) {
      console.log('[API] Payment not found, sending 404');
      return sendError(res, "Payment not found", 404);
    }

    console.log('[API] Payment deleted successfully, sending response');
    return sendSuccess(res, { success: true, id });
  } catch (error) {
    console.error('[API] Error in DELETE handler:', error);
    console.error('[API] Error details:', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    });
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

// Log any request hitting this router
router.use((req, res, next) => {
  console.log('[Payments Router] Hit payments router:', req.method, req.path);
  next();
});

export default router;