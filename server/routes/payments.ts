import { Router } from 'express';
import { storage } from '../storage';
import { insertPaymentSchema, partialPaymentSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

// Get payments with optional filters
router.get("/", async (req, res) => {
  try {
    const bowlerId = req.query.bowlerId ? parseInt(req.query.bowlerId as string) : undefined;
    const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
    const weekOf = req.query.weekOf ? new Date(req.query.weekOf as string) : undefined;

    const payments = await storage.getPayments(bowlerId, leagueId, teamId, weekOf);
    console.log('[Payments Route] Retrieved payments:', {
      filters: { bowlerId, leagueId, teamId, weekOf },
      count: payments.length
    });
    sendSuccess(res, payments);
  } catch (error) {
    console.error('[Payments Route] Get error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch payments');
  }
});

// Create new payment
router.post("/", async (req, res) => {
  try {
    console.log('[Payments Route] Creating payment with body:', req.body);
    const payment = insertPaymentSchema.parse(req.body);

    // Validate check number if payment type is check
    if (payment.type === 'check' && !payment.checkNumber) {
      return sendError(res, 'Check number is required for check payments', 400, 'VALIDATION_ERROR');
    }

    const created = await storage.createPayment(payment);
    console.log('[Payments Route] Created payment:', created);
    sendSuccess(res, created, 201);
  } catch (error) {
    console.error('[Payments Route] Create error:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error, 400, "VALIDATION_ERROR");
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create payment');
    }
  }
});

// Update payment
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const update = partialPaymentSchema.parse(req.body);

    // If updating to check payment type, ensure check number is provided
    if (update.type === 'check' && !update.checkNumber) {
      return sendError(res, 'Check number is required for check payments', 400, 'VALIDATION_ERROR');
    }

    const updated = await storage.updatePayment(id, update);
    if (!updated) {
      return sendError(res, "Payment not found", 404, "NOT_FOUND");
    }

    console.log('[Payments Route] Updated payment:', updated);
    sendSuccess(res, updated);
  } catch (error) {
    console.error('[Payments Route] Update error:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error, 400, "VALIDATION_ERROR");
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update payment');
    }
  }
});

// Delete payment
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid payment ID", 400, "INVALID_ID");
    }

    console.log('[Payments Route] Deleting payment:', id);
    await storage.deletePayment(id);

    // Return a JSON response instead of an empty response
    res.status(200).json({
      success: true,
      message: "Payment deleted successfully"
    });
  } catch (error) {
    console.error('[Payments Route] Delete error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to delete payment');
  }
});

export default router;