import { Router } from 'express';
import { storage } from '../storage';
import { insertPaymentSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';
import { processPayment } from '../services/square';

const router = Router();

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

// Delete payment endpoint
router.delete("/:id", async (req, res) => {
  try {
    console.log('[API] DELETE route handler entered');
    const id = parseInt(req.params.id);
    console.log(`[API] DELETE /api/payments/${id} - Parsed ID:`, id, typeof id);

    if (isNaN(id)) {
      console.error('[API] Invalid payment ID format:', req.params.id);
      return sendError(res, "Invalid payment ID", 400);
    }

    console.log(`[API] Checking if payment ${id} exists before deletion`);
    const payments = await storage.getPayments(undefined, undefined, [id]);
    
    if (payments.length === 0) {
      console.error(`[API] Payment ${id} not found`);
      return sendError(res, `Payment ${id} not found`, 404);
    }

    console.log(`[API] Starting deletion of payment ${id}`);
    await storage.deletePayment(id);

    console.log(`[API] Verifying deletion of payment ${id}`);
    const verifyPayments = await storage.getPayments(undefined, undefined, [id]);
    
    if (verifyPayments.length > 0) {
      console.error(`[API] Payment ${id} still exists after deletion`);
      return sendError(res, `Failed to delete payment: Payment still exists`, 500);
    }

    console.log(`[API] Successfully deleted payment ${id}`);
    return sendSuccess(res, { message: 'Payment deleted' });
  } catch (error) {
    console.error('[API] Error in payment deletion route:', error);
    return sendError(res, 
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});

export default router;