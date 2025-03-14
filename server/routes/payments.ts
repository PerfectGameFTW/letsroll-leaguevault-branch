import { Router } from 'express';
import { storage } from '../storage.js';
import { insertPaymentSchema, partialPaymentSchema } from "@shared/schema.js";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api.js';
import { processPayment } from '../services/square.js';

// Helper function to check if user has access to a payment
async function hasAccessToPayment(req: any, paymentId: number): Promise<boolean> {
  // Admin users have access to all payments
  if (req.user?.isAdmin) {
    return true;
  }
  
  // If the user has no organization, they can't access organization-specific data
  if (!req.user?.organizationId) {
    return false;
  }
  
  try {
    // Get the payment
    const payments = await storage.getPayments(undefined, undefined, undefined, undefined);
    const payment = payments.find(p => p.id === paymentId);
    if (!payment) {
      return false;
    }
    
    // Get the league
    const league = await storage.getLeague(payment.leagueId);
    if (!league) {
      return false;
    }
    
    // If league has no organization, it's accessible to all
    if (league.organizationId === null) {
      return true;
    }
    
    // Check if user belongs to the same organization as the league
    return req.user.organizationId === league.organizationId;
  } catch (error) {
    console.error(`[Payments Route] Error checking payment access:`, error);
    return false;
  }
}

// Helper function to filter payments by user's organization
async function filterPaymentsByOrganization(req: any, payments: any[]): Promise<any[]> {
  // Admin users can see all payments
  if (req.user?.isAdmin) {
    return payments;
  }
  
  // For dashboards and charts, allow access to payment type and status info for all users
  // This is safe as we don't expose personal or sensitive information
  if (!req.user) {
    return payments;
  }
  
  // If the user has no organization but is authenticated, filter based on organization
  if (!req.user.organizationId) {
    // For non-admin authenticated users without an organization, only show payments from leagues without an organization
    const leagues = await storage.getLeagues(null);
    if (!leagues || leagues.length === 0) {
      return [];
    }
    
    // Get league IDs with no organization
    const leagueIds = leagues.map(l => l.id);
    
    // Filter payments by league IDs
    return payments.filter(payment => leagueIds.includes(payment.leagueId));
  }
  
  // Get all leagues in user's organization
  const leagues = await storage.getLeagues(req.user.organizationId);
  if (!leagues || leagues.length === 0) {
    return [];
  }
  
  // Get league IDs in user's organization
  const leagueIds = leagues.map(l => l.id);
  
  // Filter payments by league IDs
  return payments.filter(payment => leagueIds.includes(payment.leagueId));
}

const router = Router();

// Add Square payment endpoint
router.post("/square/process", async (req, res) => {
  try {
    const { sourceId, amount, locationId } = req.body;

    if (!sourceId || !amount || !locationId) {
      return sendError(res, "Missing required payment information", 400);
    }

    const payment = await processPayment(sourceId, amount, locationId);
    sendSuccess(res, payment);
  } catch (error) {
    console.error('[Payments Route] Square payment error:', error);
    sendError(res, error instanceof Error ? error.message : 'Payment processing failed');
  }
});

// Get payments with optional filters
router.get("/", async (req, res) => {
  try {
    const bowlerId = req.query.bowlerId ? parseInt(req.query.bowlerId as string) : undefined;
    const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
    const weekOf = req.query.weekOf ? new Date(req.query.weekOf as string) : undefined;

    console.log('[Payments Route] GET request with filters:', {
      bowlerId,
      leagueId,
      teamId,
      weekOf: weekOf?.toISOString(),
      rawQuery: req.query,
      user: req.user ? { 
        id: req.user.id, 
        isAdmin: req.user.isAdmin,
        organizationId: req.user.organizationId
      } : null
    });

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
    
    console.log('[Payments Route] Retrieved payments:', {
      filters: { bowlerId, leagueId, teamId, weekOf },
      count: accessiblePayments.length,
      samples: accessiblePayments.slice(0, 2).map(p => ({
        id: p.id,
        amount: p.amount,
        bowlerId: p.bowlerId,
        type: p.type,
        status: p.status
      }))
    });
    
    sendSuccess(res, accessiblePayments);
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
    
    // Check if user has access to this payment
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToPayment(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to delete this payment", 403, 'FORBIDDEN');
      }
    }

    console.log('[Payments Route] Deleting payment:', id);
    await storage.deletePayment(id);

    // Return a JSON response with success status
    sendSuccess(res, { message: "Payment deleted successfully" }, 200);
  } catch (error) {
    console.error('[Payments Route] Delete error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to delete payment');
  }
});

export default router;