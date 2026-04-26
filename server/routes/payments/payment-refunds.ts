/**
 * Payment refund endpoints (mounted under /api/payments).
 *
 * Refunds delegate the provider call to the configured payment provider but
 * the database row in `payments` remains the source of truth for the
 * user-visible payment list.
 *
 * Task #503 — Square refund-receipt behavior:
 *
 * Square's hosted "refund receipt" email is automatically sent ONLY when the
 * ORIGINAL payment carried a `buyerEmailAddress`. The Refunds API itself does
 * NOT take a buyer email parameter, and we do not attempt to send a separate
 * refund-receipt email from our side. As a consequence, when the original
 * payment row was persisted with `receiptEmailMissing: true` (i.e. the
 * checkout ran without a buyer email — typically pre-#503 rows or autopay
 * runs that hit the warn+flag path), the refund will succeed at Square but
 * NO refund receipt will be emailed by Square.
 *
 * The UI (refund-payment-dialog.tsx) surfaces this fact with an inline
 * notice when the original payment has `receiptEmailMissing: true` so the
 * admin can resend manually via the admin Resend Receipt action.
 *
 * Going forward, the interactive Square charge route hard-enforces a buyer
 * email (charges.ts -> BUYER_EMAIL_REQUIRED), so all NEW Square charges from
 * the UI will have an email on file and refunds will get auto-receipts.
 */
import { Router } from 'express';
import { storage } from '../../storage';
import { isCardPaymentType } from "@shared/schema/constants";
import { sendSuccess, sendError } from '../../utils/api.js';
import { getPaymentProvider, ProviderNotConfiguredError } from '../../services/payment-provider-factory';
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

    const providerPaymentRef = payment.cardpointeRetref || payment.providerPaymentId;
    if (providerPaymentRef && isCardPaymentType(payment.type)) {
      const league = await storage.getLeague(payment.leagueId);
      const locationId = league?.locationId ?? null;
      const provider = await getPaymentProvider(locationId);
      const refundResult = await provider.refundPayment(providerPaymentRef, payment.amount, reason);
      providerRefundId = refundResult.refundId;
    }

    const refunded = await storage.refundPayment(id, providerRefundId, reason);
    sendSuccess(res, refunded);
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return sendError(res, 'Payment provider not available for refund processing', 422, 'PROVIDER_NOT_CONFIGURED');
    }
    log.error('Refund error:', error);
    sendError(res, 'Failed to process refund');
  }
});

export default router;
