
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

router.get("/", async (req, res) => {
  try {
    const bowlerId = req.query.bowlerId ? parseInt(req.query.bowlerId as string) : undefined;
    const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
    console.log('GET /api/payments - Fetching with filters:', { bowlerId, leagueId, teamId });

    const payments = await storage.getPayments(bowlerId, leagueId);
    console.log(`GET /api/payments - Found ${payments.length} payments:`, 
      payments.map(p => ({
        id: p.id,
        bowlerId: p.bowlerId,
        amount: p.amount,
        weekOf: p.weekOf,
        status: p.status
      }))
    );
    sendSuccess(res, payments);
  } catch (error) {
    console.error('GET /api/payments - Error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch payments');
  }
});

router.delete("/:id", async (req, res) => {
  console.log('[API] DELETE route handler entered for payment:', req.params.id);
  try {
    const id = parseInt(req.params.id);
    console.log('[API] Parsed ID:', id);
    
    if (isNaN(id)) {
      console.error('[API] Invalid payment ID:', req.params.id);
      return sendError(res, "Invalid payment ID", 400);
    }
    
    console.log('[API] Attempting to delete payment:', id);
    const result = await storage.deletePayment(id);
    console.log('[API] Delete operation result:', result);
    
    if (!result) {
      return sendError(res, "Payment not found", 404);
    }
    
    console.log('[API] Payment deleted successfully');
    return sendSuccess(res, { message: 'Payment deleted' });
  } catch (error) {
    console.error('[API] Error in DELETE handler:', error);
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

router.post("/process", async (req, res) => {
  try {
    const { sourceId, amount, locationId } = req.body;
    const result = await processPayment(sourceId, amount, locationId);
    sendSuccess(res, result);
  } catch (error) {
    console.error('Payment processing error:', error);
    sendError(res, error instanceof Error ? error.message : "Payment processing failed", 500);
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
