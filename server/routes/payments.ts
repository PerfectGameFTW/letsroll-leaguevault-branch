import { Router } from 'express';
import { storage } from '../storage.js';
import { insertPaymentScheduleSchema } from "@shared/schema.js";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api.js';
import { processPayment } from '../services/square.js';
import { paymentScheduler } from '../services/payment-scheduler.js';

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
      rawQuery: req.query
    });

    const payments = await storage.getPayments(bowlerId, leagueId, teamId, weekOf);
    console.log('[Payments Route] Retrieved payments:', {
      filters: { bowlerId, leagueId, teamId, weekOf },
      count: payments.length,
      samples: payments.slice(0, 2).map(p => ({
        id: p.id,
        amount: p.amount,
        bowlerId: p.bowlerId,
        type: p.type,
        status: p.status
      }))
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

    // Convert null notes to undefined to match the schema
    if (update.notes === null) {
      update.notes = undefined;
    }

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

    // Return a JSON response with success status
    sendSuccess(res, { message: "Payment deleted successfully" }, 200);
  } catch (error) {
    console.error('[Payments Route] Delete error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to delete payment');
  }
});

// Add this route before the PATCH endpoint
router.get("/schedules", async (req, res) => {
  try {
    const bowlerId = parseInt(req.query.bowlerId as string);
    const leagueId = parseInt(req.query.leagueId as string);

    if (isNaN(bowlerId) || isNaN(leagueId)) {
      return sendError(res, "Invalid bowlerId or leagueId", 400, "INVALID_PARAMETERS");
    }

    console.log('[Payments Route] Fetching payment schedule:', { bowlerId, leagueId });

    const schedule = await storage.getPaymentSchedule(bowlerId, leagueId);

    if (!schedule) {
      console.log('[Payments Route] No schedule found for:', { bowlerId, leagueId });
      return sendError(res, "Payment schedule not found", 404, "NOT_FOUND");
    }

    console.log('[Payments Route] Found schedule:', {
      id: schedule.id,
      frequency: schedule.frequency,
      amount: schedule.amount
    });

    sendSuccess(res, schedule);
  } catch (error) {
    console.error('[Payments Route] Error fetching schedule:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch payment schedule');
  }
});


// Update payment schedule endpoint
router.patch("/schedules/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      console.error('[Payments Route] Invalid schedule ID:', req.params.id);
      return sendError(res, "Invalid schedule ID", 400, "INVALID_ID");
    }

    console.log('[Payments Route] Updating payment schedule:', {
      scheduleId: id,
      updates: req.body
    });

    // Create a schema for updating payment schedule that only allows frequency and amount
    const updateScheduleSchema = z.object({
      frequency: z.enum(["weekly", "monthly"]),
      amount: z.number().int().positive(),
      bowlerId: z.number().int().positive(),
      leagueId: z.number().int().positive()
    });

    const updates = updateScheduleSchema.parse(req.body);
    console.log('[Payments Route] Validated updates:', updates);

    // Get the current schedule to ensure it exists
    const currentSchedule = await storage.getPaymentSchedule(updates.bowlerId, updates.leagueId);
    if (!currentSchedule) {
      console.error('[Payments Route] Schedule not found:', id);
      return sendError(res, "Payment schedule not found", 404, "NOT_FOUND");
    }

    console.log('[Payments Route] Current schedule found:', {
      id: currentSchedule.id,
      frequency: currentSchedule.frequency,
      amount: currentSchedule.amount,
      cardId: currentSchedule.squareCardId
    });

    // Calculate the next payment date based on the new frequency
    const nextPaymentDate = new Date();
    nextPaymentDate.setDate(nextPaymentDate.getDate() + (updates.frequency === 'weekly' ? 7 : 28));

    try {
      // Update the schedule with new values, preserving existing data
      const updatedSchedule = await storage.updatePaymentSchedule(id, {
        ...currentSchedule,
        frequency: updates.frequency,
        amount: updates.amount,
        nextPaymentDate,
        bowlerId: updates.bowlerId,
        leagueId: updates.leagueId
      });

      console.log('[Payments Route] Schedule updated successfully:', {
        id: updatedSchedule.id,
        newFrequency: updatedSchedule.frequency,
        newAmount: updatedSchedule.amount,
        nextPaymentDate: updatedSchedule.nextPaymentDate
      });

      // Notify the payment scheduler about the updated schedule
      await paymentScheduler.updateSchedule(updatedSchedule);
      console.log('[Payments Route] Payment scheduler notified of update');

      sendSuccess(res, updatedSchedule);
    } catch (storageError) {
      console.error('[Payments Route] Failed to update schedule in storage:', storageError);
      throw new Error('Failed to update payment schedule in storage');
    }
  } catch (error) {
    console.error('[Payments Route] Update schedule error:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error, 400, "VALIDATION_ERROR");
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update payment schedule');
    }
  }
});

// Add this endpoint after the PATCH /schedules/:id endpoint
router.delete("/schedules/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      console.error('[Payments Route] Invalid schedule ID:', req.params.id);
      return sendError(res, { message: "Invalid schedule ID" }, 400, "INVALID_ID");
    }

    console.log('[Payments Route] Deleting payment schedule:', id);

    // Get the schedule first to ensure it exists
    const schedule = await storage.getPaymentScheduleById(id);
    if (!schedule) {
      console.error('[Payments Route] Schedule not found:', id);
      return sendError(res, { message: "Payment schedule not found" }, 404, "NOT_FOUND");
    }

    console.log('[Payments Route] Found schedule to delete:', {
      id: schedule.id,
      bowlerId: schedule.bowlerId,
      leagueId: schedule.leagueId,
      frequency: schedule.frequency
    });

    // Delete the schedule
    await storage.deletePaymentSchedule(id);

    // Notify the payment scheduler to stop tracking this schedule
    await paymentScheduler.removeSchedule(id);

    console.log('[Payments Route] Successfully deleted payment schedule:', id);
    return sendSuccess(res, { message: "Payment schedule deleted successfully" });
  } catch (error) {
    console.error('[Payments Route] Delete schedule error:', error);
    return sendError(res, { 
      message: error instanceof Error ? error.message : 'Failed to delete payment schedule',
      code: "DELETION_ERROR" 
    }, 500);
  }
});

export default router;