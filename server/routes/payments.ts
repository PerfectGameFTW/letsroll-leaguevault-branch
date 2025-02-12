import { Router } from 'express';
import { storage } from '../storage';
import { insertPaymentSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

// Get payments with optional filters
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

// Delete payment by ID
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid payment ID", 400, "INVALID_ID");
    }

    const result = await storage.deletePayment(id);
    if (!result) {
      return sendError(res, "Payment not found", 404, "NOT_FOUND");
    }

    return sendSuccess(res, { success: true, id });
  } catch (error) {
    console.error('[Payments Route] Delete error:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to delete payment', 500);
  }
});

// Create new payment
router.post("/", async (req, res) => {
  try {
    const payment = insertPaymentSchema.parse(req.body);
    const created = await storage.createPayment(payment);
    sendSuccess(res, created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400, "VALIDATION_ERROR");
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create payment');
    }
  }
});

// Update payment status
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
      sendError(res, error, 400, "VALIDATION_ERROR");
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update payment status');
    }
  }
});

export default router;