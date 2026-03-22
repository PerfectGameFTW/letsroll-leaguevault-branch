import { Router } from 'express';
import { storage } from '../storage';
import { insertPaymentSchema, updatePaymentSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError, sendPaginatedSuccess, parsePaginationParams } from '../utils/api.js';
import { refundPayment as squareRefund } from '../services/square.js';
import { hasAccessToPayment, requireOrganizationAccess } from '../utils/access-control.js';
import { paymentWriteLimiter } from '../middleware/rate-limit.js';
import { differenceInWeeks } from 'date-fns';
import { paymentScheduler } from '../services/payment-scheduler.js';
import { db } from '../db.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { payments as paymentsTable } from '@shared/schema';
import { createLogger } from '../logger';

const log = createLogger("Payments");

const router = Router();

// Get payments with optional filters
router.get("/", async (req, res) => {
  try {
    const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
    const isSystemAdmin = req.user?.role === 'system_admin';
    const rawQueryOrgId = req.query.organizationId ? parseInt(req.query.organizationId as string) : undefined;
    if (rawQueryOrgId !== undefined && isNaN(rawQueryOrgId)) {
      return sendError(res, "Invalid organization ID format", 400);
    }
    // Effective org context: explicit param > sysadmin's own org > null (unaffiliated sysadmin)
    const effectiveOrgId: number | null = isSystemAdmin
      ? (rawQueryOrgId ?? req.user?.organizationId ?? null)
      : (req.user?.organizationId ?? null);

    if (leagueId) {
      const league = await storage.getLeague(leagueId);
      if (!league) {
        return sendError(res, "League not found", 404, 'NOT_FOUND');
      }
      if (!requireOrganizationAccess(req, league.organizationId, 'league', leagueId)) {
        return sendError(res, "You don't have access to this league's payments", 403, 'FORBIDDEN');
      }
    }

    if (!isSystemAdmin && effectiveOrgId === null) {
      return sendSuccess(res, []);
    }

    const baseFilters = {
      bowlerId: req.query.bowlerId ? parseInt(req.query.bowlerId as string) : undefined,
      leagueId,
      teamId: req.query.teamId ? parseInt(req.query.teamId as string) : undefined,
      weekOf: req.query.weekOf ? new Date(req.query.weekOf as string) : undefined,
    };

    const paginationParams = parsePaginationParams(req.query);

    if (isSystemAdmin && effectiveOrgId === null) {
      if (paginationParams) {
        const allPayments = await storage.getAllPayments();
        const filtered = allPayments.slice((paginationParams.page - 1) * paginationParams.limit, paginationParams.page * paginationParams.limit);
        return sendPaginatedSuccess(res, filtered, { page: paginationParams.page, limit: paginationParams.limit, total: allPayments.length, totalPages: Math.ceil(allPayments.length / paginationParams.limit) });
      }
      const payments = await storage.getAllPayments();
      return sendSuccess(res, payments);
    }

    const filters = { ...baseFilters, organizationId: effectiveOrgId! };

    if (paginationParams) {
      const result = await storage.getPaymentsPaginated(filters, paginationParams.page, paginationParams.limit);
      return sendPaginatedSuccess(res, result.items, result.pagination);
    }

    const payments = await storage.getPayments(filters);
    
    sendSuccess(res, payments);
  } catch (error) {
    log.error('Get error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch payments');
  }
});

// Create new payment
router.post("/", paymentWriteLimiter, async (req, res) => {
  try {
    const payment = insertPaymentSchema.parse(req.body);

    // Validate check number if payment type is check
    if (payment.type === 'check' && !payment.checkNumber) {
      return sendError(res, 'Check number is required for check payments', 400, 'VALIDATION_ERROR');
    }
    
    const league = await storage.getLeague(payment.leagueId);
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    if (!requireOrganizationAccess(req, league.organizationId, 'league', payment.leagueId)) {
      return sendError(res, "You don't have access to create payments for this league", 403, 'FORBIDDEN');
    }

    const lineageAmount = (league.lineageFee != null && league.weeklyFee > 0)
      ? Math.round(payment.amount * league.lineageFee / league.weeklyFee)
      : undefined;
    const prizeFundAmount = (league.prizeFundFee != null && league.weeklyFee > 0)
      ? Math.round(payment.amount * league.prizeFundFee / league.weeklyFee)
      : undefined;

    const created = await storage.createPayment({
      ...payment,
      lineageAmount,
      prizeFundAmount,
    });

    if (payment.status === 'paid' && league.seasonStart && league.seasonEnd && league.weeklyFee) {
      try {
        const seasonStart = new Date(league.seasonStart);
        const seasonEnd = new Date(league.seasonEnd);
        const totalWeeks = Math.max(0, differenceInWeeks(seasonEnd, seasonStart));
        const fullSeasonAmount = league.weeklyFee * totalWeeks;

        if (fullSeasonAmount > 0) {
          const totalPaidResult = await db
            .select({ total: sql<number>`COALESCE(SUM(${paymentsTable.amount}), 0)` })
            .from(paymentsTable)
            .where(and(
              eq(paymentsTable.bowlerId, payment.bowlerId),
              eq(paymentsTable.leagueId, payment.leagueId),
              eq(paymentsTable.status, 'paid'),
              gte(paymentsTable.weekOf, seasonStart.toISOString()),
              lte(paymentsTable.weekOf, seasonEnd.toISOString())
            ));
          const totalPaid = Number(totalPaidResult[0]?.total || 0);

          if (totalPaid >= fullSeasonAmount) {
            const activeSchedule = await storage.getPaymentSchedule(payment.bowlerId, payment.leagueId);
            if (activeSchedule) {
              await storage.deactivatePaymentSchedule(activeSchedule.id);
              await paymentScheduler.removeSchedule(activeSchedule.id);
              log.info(`Bowler ${payment.bowlerId} paid in full for league ${payment.leagueId}, auto-cancelled schedule ${activeSchedule.id}`);
            }
          }
        }
      } catch (pifError) {
        log.error('Error checking paid-in-full:', pifError);
      }
    }

    sendSuccess(res, created, 201);
  } catch (error) {
    log.error('Create error:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error.errors.map(e => e.message).join(', '), 400, "VALIDATION_ERROR");
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create payment');
    }
  }
});

// Update payment
router.patch("/:id", paymentWriteLimiter, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const parsed = updatePaymentSchema.parse(req.body);

    const update = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, v === null ? undefined : v])
    ) as z.infer<typeof updatePaymentSchema>;

    // If updating to check payment type, ensure check number is provided
    if (update.type === 'check' && !update.checkNumber) {
      return sendError(res, 'Check number is required for check payments', 400, 'VALIDATION_ERROR');
    }
    
    // Check if user has access to this payment
    if (req.user?.role !== 'system_admin') {
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
    log.error('Update error:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error.errors.map(e => e.message).join(', '), 400, "VALIDATION_ERROR");
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update payment');
    }
  }
});

// Delete payment
router.delete("/:id", paymentWriteLimiter, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid payment ID", 400, "INVALID_ID");
    }

    const payment = await storage.getPaymentById(id);
    if (!payment) {
      return sendError(res, "Payment not found", 404, "NOT_FOUND");
    }

    if (payment.type === 'credit_card' && req.user?.role !== 'system_admin' && req.user?.role !== 'org_admin') {
      return sendError(res, "Only admins can delete credit card payments", 403, "FORBIDDEN");
    }

    if (req.user?.role !== 'system_admin') {
      const hasAccess = await hasAccessToPayment(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to delete this payment", 403, 'FORBIDDEN');
      }
    }

    await storage.deletePayment(id);

    sendSuccess(res, { message: "Payment deleted successfully" }, 200);
  } catch (error) {
    log.error('Delete error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to delete payment');
  }
});

router.post("/:id/refund", paymentWriteLimiter, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid payment ID", 400, "INVALID_ID");
    }

    if (req.user?.role !== 'system_admin' && req.user?.role !== 'org_admin') {
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

    if (req.user.role !== 'system_admin') {
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
    log.error('Refund error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to process refund');
  }
});

export default router;