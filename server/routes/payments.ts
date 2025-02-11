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
    const payments = await storage.getPayments(bowlerId, leagueId);
    sendSuccess(res, payments);
  } catch (error) {
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

// Add PATCH endpoint for updating payment amount
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { amount } = z.object({
      amount: z.number().int().positive(),
    }).parse(req.body);

    // Update payment amount in storage
    const updated = await storage.updatePayment(id, { amount });
    sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update payment');
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