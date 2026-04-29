/**
 * Payment refund endpoints (mounted under /api/payments). Square only
 * auto-emails a refund receipt when the original payment carried a
 * buyerEmailAddress, so rows with `receiptEmailMissing: true` get a
 * UI notice (refund-payment-dialog.tsx) prompting an admin resend.
 */
import { Router } from 'express';
import { storage } from '../../storage';
import { isCardPaymentType } from "@shared/schema/constants";
import { sendSuccess, sendError, sanitizePayment } from '../../utils/api.js';
import {
  getPaymentProvider,
  ProviderNotConfiguredError,
  PaymentProviderError,
  sanitizePaymentUserMessage,
} from '../../services/payment-provider-factory';
import { hasAccessToPayment } from '../../utils/access-control.js';
import { paymentWriteLimiter } from '../../middleware/rate-limit.js';
import { createLogger } from '../../logger';

const log = createLogger("Payments");

const router = Router();

router.post("/:id/refund", paymentWriteLimiter, async (req, res) => {
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

    if (!isCardPaymentType(payment.type)) {
      return sendError(res, "Only card payments can be refunded", 400, "INVALID_TYPE");
    }

    if (req.user.role !== 'system_admin') {
      const hasAccess = await hasAccessToPayment(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to refund this payment", 403, "FORBIDDEN");
      }
    }

    const { reason } = req.body || {};
    let providerRefundId: string | undefined;

    const providerPaymentRef = payment.cloverChargeId || payment.providerPaymentId;
    if (providerPaymentRef && isCardPaymentType(payment.type)) {
      const league = await storage.getLeague(payment.leagueId);
      const locationId = league?.locationId ?? null;
      const provider = await getPaymentProvider(locationId);
      const refundResult = await provider.refundPayment(providerPaymentRef, payment.amount, reason);
      providerRefundId = refundResult.refundId;
    }

    const refunded = await storage.refundPayment(id, providerRefundId, reason);
    sendSuccess(res, sanitizePayment(refunded));
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return sendError(res, 'Payment provider not available for refund processing', 422, 'PROVIDER_NOT_CONFIGURED');
    }
    log.error('Refund error:', error);

    // Mirror the charge route (server/routes/payments-provider/charges.ts):
    // surface the provider's typed `userMessage` + `code` so admins see
    // the actionable reason ("Your payment was declined…", "Refund could
    // not be processed.", etc.) instead of the generic "Failed to process
    // refund" wall. Anything not wrapped in PaymentProviderError still
    // falls through to that legacy fallback so a stray bare `Error` —
    // which may carry stack-trace text in `.message` — never leaks out.
    let userMessage = 'Failed to process refund';
    let userCode = 'REFUND_ERROR';
    if (error instanceof PaymentProviderError) {
      userMessage = error.userMessage;
      userCode = error.code;
    }
    userMessage = sanitizePaymentUserMessage(userMessage);

    sendError(res, userMessage, 500, userCode);
  }
});

export default router;
