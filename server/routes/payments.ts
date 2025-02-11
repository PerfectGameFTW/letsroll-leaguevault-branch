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
    console.log(`GET /api/payments - Found ${payments.length} payments`);
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
    console.log(`[API] DELETE /api/payments/${req.params.id} - Starting deletion`);

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      console.error('[API] Invalid payment ID format:', req.params.id);
      return sendError(res, "Invalid payment ID", 400);
    }

    // First verify the payment exists
    const existingPayments = await storage.getPayments(undefined, undefined, [id]);
    console.log('[API] Found payment to delete:', existingPayments);

    if (!existingPayments.length) {
      console.error(`[API] Payment not found with ID: ${id}`);
      return sendError(res, "Payment not found", 404);
    }

    // Perform the deletion
    await storage.deletePayment(id);
    console.log(`[API] Successfully deleted payment ID: ${id}`);

    // Verify deletion by checking if the payment still exists
    const verifyDeleted = await storage.getPayments(undefined, undefined, [id]);
    if (verifyDeleted.length > 0) {
      console.error(`[API] Payment ${id} still exists after deletion`);
      throw new Error('Payment deletion failed - payment still exists');
    }

    console.log(`[API] Successfully verified deletion of payment ${id}`);

    // Return 204 No Content on successful deletion
    res.status(204).end();
  } catch (error) {
    console.error('[API] Error in payment deletion route:', error);
    sendError(res,
      error instanceof Error ?
        `Failed to delete payment: ${error.message}` :
        'Internal server error',
      500
    );
  }
});

export default router;