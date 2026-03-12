import { Router } from 'express';
import { storage } from '../storage.js';
import { insertPaymentSchema, partialPaymentSchema } from "@shared/schema.js";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api.js';
import { refundPayment as squareRefund } from '../services/square.js';
import { hasAccessToPayment, filterPaymentsByOrganization } from '../utils/access-control.js';

const router = Router();

// Get payments with optional filters
router.get("/", async (req, res) => {
  try {
    const bowlerId = req.query.bowlerId ? parseInt(req.query.bowlerId as string) : undefined;
    const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
    const weekOf = req.query.weekOf ? new Date(req.query.weekOf as string) : undefined;

    // If leagueId is provided and user is not admin, check organization access
    if (leagueId && !req.user?.isAdmin && req.user?.organizationId) {
      const league = await storage.getLeague(leagueId);
      
      if (!league) {
        return sendError(res, "League not found", 404, 'NOT_FOUND');
      }
      
      if (league.organizationId !== null && league.organizationId !== req.user.organizationId) {
        return sendError(res, "You don't have access to this league's payments", 403, 'FORBIDDEN');
      }
    }

    const payments = await storage.getPayments(bowlerId, leagueId, teamId, weekOf);
    
    // Filter payments by organization if needed
    let accessiblePayments = payments;
    if (!req.user?.isAdmin) {
      accessiblePayments = await filterPaymentsByOrganization(req, payments);
    }
    
    sendSuccess(res, accessiblePayments);
  } catch (error) {
    console.error('[Payments Route] Get error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch payments');
  }
});

// Create new payment
router.post("/", async (req, res) => {
  try {
    const payment = insertPaymentSchema.parse(req.body);

    // Validate check number if payment type is check
    if (payment.type === 'check' && !payment.checkNumber) {
      return sendError(res, 'Check number is required for check payments', 400, 'VALIDATION_ERROR');
    }
    
    // If user is not admin, check league organization access
    if (!req.user?.isAdmin && req.user?.organizationId) {
      const league = await storage.getLeague(payment.leagueId);
      
      if (!league) {
        return sendError(res, "League not found", 404, 'NOT_FOUND');
      }
      
      // If league belongs to an organization, check if user has access
      if (league.organizationId !== null && league.organizationId !== req.user.organizationId) {
        return sendError(res, "You don't have access to create payments for this league", 403, 'FORBIDDEN');
      }
    }

    const created = await storage.createPayment(payment);
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

    // Convert null notes to undefined to match the schema
    if (update.notes === null) {
      update.notes = undefined;
    }

    // If updating to check payment type, ensure check number is provided
    if (update.type === 'check' && !update.checkNumber) {
      return sendError(res, 'Check number is required for check payments', 400, 'VALIDATION_ERROR');
    }
    
    // Check if user has access to this payment
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToPayment(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to update this payment", 403, 'FORBIDDEN');
      }
    }

    const updated = await storage.updatePayment(id, update);
    if (!updated) {
      return sendError(res, "Payment not found", 404, "NOT_FOUND");
    }

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
    
    // Check if user has access to this payment
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToPayment(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to delete this payment", 403, 'FORBIDDEN');
      }
    }

    await storage.deletePayment(id);

    // Return a JSON response with success status
    sendSuccess(res, { message: "Payment deleted successfully" }, 200);
  } catch (error) {
    console.error('[Payments Route] Delete error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to delete payment');
  }
});

router.post("/:id/refund", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid payment ID", 400, "INVALID_ID");
    }

    if (!req.user?.isAdmin && !req.user?.isOrganizationAdmin) {
      return sendError(res, "Only admins can process refunds", 403, "FORBIDDEN");
    }

    const payment = await storage.getPaymentById(id);
    if (!payment) {
      return sendError(res, "Payment not found", 404, "NOT_FOUND");
    }

    if (payment.status === 'refunded') {
      return sendError(res, "Payment has already been refunded", 400, "ALREADY_REFUNDED");
    }

    if (payment.status !== 'paid') {
      return sendError(res, "Only paid payments can be refunded", 400, "INVALID_STATUS");
    }

    if (payment.type !== 'credit_card') {
      return sendError(res, "Only credit card payments can be refunded", 400, "INVALID_TYPE");
    }

    if (!req.user.isAdmin) {
      const hasAccess = await hasAccessToPayment(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to refund this payment", 403, "FORBIDDEN");
      }
    }

    const { reason } = req.body || {};
    let squareRefundId: string | undefined;

    if (payment.squarePaymentId && payment.type === 'credit_card') {
      const refundResult = await squareRefund(payment.squarePaymentId, payment.amount, reason);
      squareRefundId = refundResult.refundId;
    }

    const refunded = await storage.refundPayment(id, squareRefundId, reason);
    sendSuccess(res, refunded);
  } catch (error) {
    console.error('[Payments Route] Refund error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to process refund');
  }
});

export default router;