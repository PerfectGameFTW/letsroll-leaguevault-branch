/**
 * Charge execution + verification for the payments-provider router.
 *
 * Routes:
 *  - POST /payments
 *  - GET  /payments/:paymentId/verify
 */
import { Router } from 'express';
import crypto from 'crypto';
import { getEffectiveBowlingWeeks } from '@shared/schedule-utils';
import { storage } from '../../storage';
import { sendError } from '../../utils/api.js';
import { hasAccessToLeague, hasAccessToBowler } from '../../utils/access-control.js';
import { paymentLimiter } from '../../middleware/rate-limit.js';
import { createLogger } from '../../logger';
import { getPaymentProvider, ProviderNotConfiguredError } from '../../services/payment-provider-factory';
import { computePaymentSplit, buildLineItems } from '../../services/payment-execution';
import { getProviderCustomerId, persistCardpointeProfile } from '../../services/payment-utils';
import { providerNameToPaymentType } from '@shared/schema/constants';
import { isDev } from '../../config';
import { getProviderForLeague } from './shared.js';

const log = createLogger('Payments');

const router = Router();

router.get('/payments/:paymentId/verify', async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== 'system_admin' && userRole !== 'org_admin') {
      return sendError(res, 'Admin access required', 403, 'FORBIDDEN');
    }

    const dbPayment = await storage.getPaymentById(parseInt(req.params.paymentId));
    if (!dbPayment) {
      return sendError(res, 'Payment not found', 404, 'NOT_FOUND');
    }

    if (!dbPayment.providerPaymentId) {
      return res.json({
        dbPayment: { id: dbPayment.id, amount: dbPayment.amount, status: dbPayment.status, type: dbPayment.type, createdAt: dbPayment.createdAt },
        providerPayment: null,
        message: 'No payment ID associated with this payment (cash/check payment)',
      });
    }

    const provider = await getProviderForLeague(dbPayment.leagueId);
    let providerPayment = null;
    try {
      providerPayment = await provider.getPayment(dbPayment.providerPaymentId);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        log.warn('Payment verification: provider not configured', { leagueId: dbPayment.leagueId, paymentId: dbPayment.id });
      } else {
        throw e;
      }
    }

    if (isDev) log.info('Payment verification:', {
      dbPaymentId: dbPayment.id,
      providerPaymentId: dbPayment.providerPaymentId,
      providerFound: !!providerPayment,
      providerStatus: providerPayment?.status,
      dbStatus: dbPayment.status,
    });

    res.json({
      dbPayment: {
        id: dbPayment.id,
        amount: dbPayment.amount,
        status: dbPayment.status,
        type: dbPayment.type,
        providerPaymentId: dbPayment.providerPaymentId,
        createdAt: dbPayment.createdAt,
        bowlerId: dbPayment.bowlerId,
        leagueId: dbPayment.leagueId,
      },
      providerPayment: providerPayment,
      match: providerPayment ? {
        statusMatch: (dbPayment.status === 'paid' && providerPayment.status === 'COMPLETED') ||
                     (dbPayment.status !== 'paid' && providerPayment.status !== 'COMPLETED'),
        amountMatch: String(dbPayment.amount) === providerPayment.amountMoney.amount,
      } : null,
      message: providerPayment
        ? `Payment found: ${providerPayment.status}, $${(parseInt(providerPayment.amountMoney.amount) / 100).toFixed(2)}`
        : 'Payment NOT found — payment may have failed or been processed under different credentials',
    });
  } catch (error) {
    log.error('Payment verification error:', error);
    sendError(res, 'Failed to verify payment', 500);
  }
});

router.post('/payments', paymentLimiter, async (req, res) => {
  try {
    const { sourceId, amount, bowlerId, leagueId } = req.body;

    if (isDev) log.info('Payment request received:', {
      bowlerId,
      leagueId,
      amount,
      sourceIdPrefix: sourceId?.substring(0, 10) + '...',
      userId: req.user?.id,
    });

    if (!sourceId || !bowlerId || !leagueId) {
      return sendError(res, 'Missing required payment fields', 400, 'VALIDATION_ERROR');
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return sendError(res, 'Amount must be a positive number', 400, 'VALIDATION_ERROR');
    }

    if (!await hasAccessToLeague(req, leagueId)) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    if (!await hasAccessToBowler(req, bowlerId)) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const league = await storage.getLeague(leagueId);
    if (!league) {
      return sendError(res, 'League not found', 404, 'NOT_FOUND');
    }

    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return sendError(res, 'Bowler not found', 404, 'NOT_FOUND');
    }

    if (!league.weeklyFee) {
      return sendError(res, 'League has no weekly fee configured — cannot process payment', 400, 'LEAGUE_NOT_CONFIGURED');
    }

    if (!league.seasonStart || !league.seasonEnd) {
      return sendError(res, 'League has no season dates configured — cannot process payment', 400, 'LEAGUE_NOT_CONFIGURED');
    }

    const seasonStart = new Date(league.seasonStart);
    const seasonEnd = new Date(league.seasonEnd);
    let totalWeeks: number;
    if (league.totalBowlingWeeks != null) {
      totalWeeks = getEffectiveBowlingWeeks(
        league.totalBowlingWeeks,
        league.cancelledDates ?? []
      );
    } else {
      totalWeeks = Math.max(1, Math.ceil((seasonEnd.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    }
    const fullSeasonAmount = league.weeklyFee * totalWeeks;

    const existingPayments = await storage.getPayments({ bowlerId, leagueId, organizationId: league.organizationId! });
    const totalPaid = existingPayments
      .filter((p) => p.status === 'paid')
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    const remainingBalance = Math.max(0, fullSeasonAmount - totalPaid);

    if (amount > remainingBalance) {
      return sendError(res, `Amount ($${(amount / 100).toFixed(2)}) exceeds remaining balance ($${(remainingBalance / 100).toFixed(2)})`, 400, 'AMOUNT_EXCEEDS_BALANCE');
    }

    const weekOf = new Date();
    weekOf.setHours(0, 0, 0, 0);

    const idempotencyKey = crypto
      .createHash('sha256')
      .update(`${bowlerId}:${leagueId}:${amount}:${sourceId}`)
      .digest('hex');

    const existingPayment = await storage.getPaymentByIdempotencyKey(idempotencyKey);
    const truncatedIdempotencyKey = idempotencyKey.substring(0, 39);
    if (existingPayment) {
      log.info('Payment deduplicated (same token resubmitted):', { dbPaymentId: existingPayment.id, providerPaymentId: existingPayment.providerPaymentId, bowlerId, leagueId, amount });
      return res.json({ dbPaymentId: existingPayment.id, id: existingPayment.providerPaymentId, status: 'COMPLETED', deduplicated: true });
    }

    const provider = await getPaymentProvider(league.locationId ?? null);

    const customerId = getProviderCustomerId(bowler, provider);

    if (req.body.storeCard && !customerId) {
      log.warn('Cannot store card — bowler has no customer ID:', bowlerId);
    }

    const weeklyFee = league.weeklyFee || 0;
    const quantity = weeklyFee > 0 && amount % weeklyFee === 0
      ? String(amount / weeklyFee)
      : '1';
    const lineItems = buildLineItems(league, quantity);

    // bowler.email is the default; the checkout UI may
    // also pass an explicit `buyerEmail` in the body so a bowler with
    // no email on file can still capture one inline at payment time
    // and trigger Square's hosted receipt.
    const requestBuyerEmail = typeof req.body.buyerEmail === 'string'
      ? req.body.buyerEmail.trim()
      : '';
    const buyerEmail = bowler.email || requestBuyerEmail || undefined;

    // HARD-ENFORCE buyer email for interactive Square charges.
    // This route only handles user-driven checkouts (a sourceId from a card
    // form / Apple Pay / Google Pay), so we have a human who can supply an
    // email. Autopay (server/services/payment-execution.ts) is the only
    // unattended Square path and is allowed to warn+flag without an email.
    // The matching frontend forms make the inline "Email for receipt" field
    // required when bowler.email is missing; this is the server-side guard.
    if (provider.providerName === 'square' && !buyerEmail) {
      return sendError(
        res,
        "A buyer email is required for Square card payments so the receipt can be sent. Add an email to the bowler's profile or enter one at checkout.",
        400,
        'BUYER_EMAIL_REQUIRED',
      );
    }

    // when a bowler self-checks-out (their own user account
    // is linked to this bowler row) and supplies a brand-new email at
    // checkout, persist it to their profile. This means the very next
    // charge will already have an email on file — no inline prompt and
    // no need to use the admin Resend flow.
    const isSelfCheckout = !!req.user?.bowlerId && req.user.bowlerId === bowlerId;
    if (isSelfCheckout && !bowler.email && requestBuyerEmail) {
      try {
        await storage.updateBowler(bowlerId, { email: requestBuyerEmail });
      } catch (err) {
        // Non-fatal: payment must still proceed even if profile save
        // fails (validation, race, etc.). Log for ops visibility.
        log.warn('Failed to backfill bowler email at self-checkout', {
          bowlerId, error: err instanceof Error ? err.message : err,
        });
      }
    }

    if (isDev) log.info('Processing payment:', {
      bowlerId, leagueId, amount,
      locationId: league.locationId,
      provider: provider.providerName,
      hasLineItems: lineItems.length > 0,
      hasCustomerId: !!customerId,
    });

    let payment;
    let storedCardId: string | undefined;

    if (lineItems.length > 0) {
      payment = await provider.createOrderWithPayment(
        sourceId,
        amount,
        lineItems,
        req.body.storeCard,
        customerId,
        buyerEmail,
        truncatedIdempotencyKey
      );
    } else {
      payment = await provider.processPayment(
        sourceId,
        amount,
        req.body.storeCard,
        customerId,
        buyerEmail,
        truncatedIdempotencyKey,
      );
    }

    log.info('Payment completed:', {
      paymentId: payment.id,
      paymentStatus: payment.status,
      bowlerId, leagueId, amount,
    });

    const canStoreCard = provider.providerName === 'cardpointe' || !!customerId;
    if (req.body.storeCard && canStoreCard && sourceId && !provider.validateCardId(sourceId)) {
      try {
        const savedCard = await provider.saveCardOnFile(sourceId, customerId || '');
        if (savedCard?.id) {
          log.info('Card saved on file:', savedCard.id.substring(0, 15) + '...');
          storedCardId = savedCard.id;
          try {
            await storage.updatePaymentScheduleCard(
              bowlerId,
              leagueId,
              savedCard.id
            );
          } catch (schedError) {
            if (isDev) log.info('No payment schedule to update (normal for one-time payments)');
          }
          await persistCardpointeProfile(provider, savedCard.id, bowlerId);
        }
      } catch (error) {
        log.error('Failed to save card on file:', error);
      }
    }

    const { lineageAmount, prizeFundAmount } = computePaymentSplit(amount, league);

    // Capture Square's hosted-receipt fields. Interactive Square
    // charges are gated by BUYER_EMAIL_REQUIRED above, so by the
    // time we reach this insert `buyerEmail` is always present for
    // Square — receiptEmailMissing therefore stays false here and
    // is only set true on the unattended/autopay path.
    const dbPayment = await storage.createPayment({
      bowlerId,
      leagueId,
      amount,
      lineageAmount,
      prizeFundAmount,
      weekOf: weekOf.toISOString(),
      status: 'paid',
      type: providerNameToPaymentType(provider.providerName),
      providerPaymentId: payment.id,
      cardpointeRetref: payment.providerRef?.cardpointeRetref,
      cardpointeAuthcode: payment.providerRef?.cardpointeAuthcode,
      receiptUrl: payment.receiptUrl,
      receiptNumber: payment.receiptNumber,
      receiptEmailMissing: false,
      idempotencyKey,
    });

    if (isDev) log.info('Payment recorded in DB:', {
      dbPaymentId: dbPayment.id,
      paymentId: payment.id,
      bowlerId, leagueId, amount,
    });

    res.json({
      ...payment,
      dbPaymentId: dbPayment.id,
      savedCardId: storedCardId ?? null,
    });
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return sendError(res, 'Payment system is not configured for this location', 422, 'PROVIDER_NOT_CONFIGURED');
    }
    const errDetail = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    } : error;
    type ProviderErrorDetail = { detail?: string };
    const providerErrors: ProviderErrorDetail[] | undefined = (() => {
      if (!error || typeof error !== 'object') return undefined;
      const e = error as { errors?: unknown; body?: { errors?: unknown } };
      const found = e.errors ?? e.body?.errors;
      return Array.isArray(found) ? (found as ProviderErrorDetail[]) : undefined;
    })();
    log.error('Payment processing error:', { error: errDetail, providerErrors });
    let userMessage = 'Payment processing failed. Please try again.';
    if (providerErrors?.[0]?.detail) {
      userMessage = providerErrors[0].detail;
    } else if (error instanceof Error && error.message.startsWith('{')) {
      try {
        const parsed = JSON.parse(error.message);
        userMessage = parsed.error?.message || userMessage;
      } catch {}
    }
    return sendError(res, userMessage, 500, 'PAYMENT_ERROR');
  }
});

export default router;
