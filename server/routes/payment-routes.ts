/**
 * Payment provider router (mounted at /api/payments-provider).
 *
 * Owns the **execution side** of payments: charging the payment provider
 * (Square / CardPointe), customer create/update, catalog, card vault, wallet
 * domain registration, and idempotent payment recording for live charges.
 *
 * For straight DB CRUD over the payments table (list/update/delete/refund),
 * see `payments.ts` mounted at /api/payments.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { getEffectiveBowlingWeeks } from '@shared/schedule-utils';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api.js';
import { hasAccessToLeague, hasAccessToBowler } from '../utils/access-control.js';
import { paymentLimiter } from '../middleware/rate-limit.js';
import { createLogger } from '../logger';
import { getPaymentProvider, ProviderNotConfiguredError } from '../services/payment-provider-factory';
import { hasCatalogSupport, hasWalletSupport, type PaymentProvider } from '../services/payment-provider';
import { computePaymentSplit, buildLineItems } from '../services/payment-execution';
import { getProviderCustomerId, persistCardpointeProfile } from '../services/payment-utils';
import { providerNameToPaymentType } from '@shared/schema/constants';
import { isDev } from '../config';

const log = createLogger("Payments");

async function getProviderForLeague(leagueId: number) {
  const league = await storage.getLeague(leagueId);
  const locationId = league?.locationId ?? null;
  return getPaymentProvider(locationId);
}



const router = Router();

router.use((req: any, res: any, next: any) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return sendError(res, "Authentication required", 401, 'UNAUTHORIZED');
  }
  next();
});

router.get('/payments/:paymentId/verify', async (req: any, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== 'system_admin' && userRole !== 'admin') {
      return sendError(res, "Admin access required", 403, 'FORBIDDEN');
    }

    const dbPayment = await storage.getPaymentById(parseInt(req.params.paymentId));
    if (!dbPayment) {
      return sendError(res, "Payment not found", 404, 'NOT_FOUND');
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
  } catch (error: any) {
    log.error('Payment verification error:', error);
    sendError(res, 'Failed to verify payment', 500);
  }
});

router.post('/payments', paymentLimiter, async (req: any, res) => {
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
      return sendError(res, "Missing required payment fields", 400, 'VALIDATION_ERROR');
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return sendError(res, "Amount must be a positive number", 400, 'VALIDATION_ERROR');
    }

    if (!await hasAccessToLeague(req, leagueId)) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    if (!await hasAccessToBowler(req, bowlerId)) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const league = await storage.getLeague(leagueId);
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }

    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }

    if (!league.weeklyFee) {
      return sendError(res, "League has no weekly fee configured — cannot process payment", 400, 'LEAGUE_NOT_CONFIGURED');
    }

    if (!league.seasonStart || !league.seasonEnd) {
      return sendError(res, "League has no season dates configured — cannot process payment", 400, 'LEAGUE_NOT_CONFIGURED');
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
      .filter((p: any) => p.status === 'paid')
      .reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

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

    const buyerEmail = bowler.email || undefined;

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
  } catch (error: any) {
    if (error instanceof ProviderNotConfiguredError) {
      return sendError(res, 'Payment system is not configured for this location', 422, 'PROVIDER_NOT_CONFIGURED');
    }
    const errDetail = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    } : error;
    const providerErrors = error?.errors || error?.body?.errors;
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

router.post('/customers', paymentLimiter, async (req, res) => {
  try {
    let team: any = null;
    if (req.body.teamId) {
      team = await storage.getTeam(req.body.teamId);
      
      if (!team) {
        return sendError(res, "Team not found", 404, 'NOT_FOUND');
      }
      
      const league = await storage.getLeague(team.leagueId);
      
      if (!league) {
        return sendError(res, "League not found", 404, 'NOT_FOUND');
      }
      
      const userHasAccess = 
        req.user?.role === 'system_admin' || 
        league.organizationId === null || 
        (req.user?.organizationId === league.organizationId);
      
      if (!userHasAccess) {
        return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
      }
    }

    const provider = team
      ? await getProviderForLeague(team.leagueId)
      : await getPaymentProvider(null);

    const customer = await provider.createOrUpdateCustomer(
      req.body.name,
      req.body.email,
    );

    if (!customer) {
      throw new Error('Failed to create/update customer');
    }

    res.json(customer);
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return sendError(res, 'Payment provider not configured for this location', 422, 'PROVIDER_NOT_CONFIGURED');
    }
    log.error('Customer operation error:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });
    sendError(res, 'Customer operation failed', 500);
  }
});

router.get('/catalog/categories', async (req: any, res) => {
  try {
    const locationIdParam = req.query.locationId as string | undefined;
    const lvLocationId = locationIdParam ? parseInt(locationIdParam) : null;

    if (lvLocationId && !isNaN(lvLocationId)) {
      const loc = await storage.getLocation(lvLocationId);
      if (!loc) return sendError(res, 'Location not found', 404, 'NOT_FOUND');
      const isAuthorized =
        req.user?.role === 'system_admin' ||
        (req.user?.organizationId != null && req.user.organizationId === loc.organizationId);
      if (!isAuthorized) return sendError(res, 'Forbidden', 403, 'FORBIDDEN');
    }

    let provider;
    try {
      provider = await getPaymentProvider(lvLocationId);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        log.warn('Catalog categories: provider not configured, returning empty', { locationId: lvLocationId });
        return sendSuccess(res, []);
      }
      throw e;
    }
    if (!hasCatalogSupport(provider)) {
      return sendSuccess(res, []);
    }

    const categories = await provider.listCatalogCategories();
    sendSuccess(res, categories);
  } catch (error) {
    log.error('Catalog categories error:', error);
    sendError(res, 'Failed to fetch catalog categories');
  }
});

router.get('/catalog/items', async (req: any, res) => {
  try {
    const categoryId = req.query.categoryId as string | undefined;
    const locationIdParam = req.query.locationId as string | undefined;
    const lvLocationId = locationIdParam ? parseInt(locationIdParam) : null;

    if (lvLocationId && !isNaN(lvLocationId)) {
      const loc = await storage.getLocation(lvLocationId);
      if (!loc) return sendError(res, 'Location not found', 404, 'NOT_FOUND');
      const isAuthorized =
        req.user?.role === 'system_admin' ||
        (req.user?.organizationId != null && req.user.organizationId === loc.organizationId);
      if (!isAuthorized) return sendError(res, 'Forbidden', 403, 'FORBIDDEN');
    }

    let provider;
    try {
      provider = await getPaymentProvider(lvLocationId);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        log.warn('Catalog items: provider not configured, returning empty', { locationId: lvLocationId });
        return sendSuccess(res, []);
      }
      throw e;
    }
    if (!hasCatalogSupport(provider)) {
      return sendSuccess(res, []);
    }

    const items = await provider.listCatalogItems(categoryId);
    sendSuccess(res, items);
  } catch (error) {
    log.error('Catalog list error:', error);
    sendError(res, 'Failed to fetch catalog items');
  }
});

router.post('/cards/:bowlerId', async (req, res) => {
  try {
    const bowlerId = parseInt(req.params.bowlerId);
    if (isNaN(bowlerId)) return sendError(res, 'Invalid bowler ID', 400);

    if (!req.isAuthenticated()) {
      return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
    }

    if (!await hasAccessToBowler(req, bowlerId)) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const { sourceId } = req.body;
    if (!sourceId || typeof sourceId !== 'string') {
      return sendError(res, 'sourceId is required', 400);
    }

    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return sendError(res, 'Bowler not found', 404);
    }

    const cardLeagueId = req.body.leagueId ? parseInt(req.body.leagueId) : null;

    const provider = cardLeagueId
      ? await getProviderForLeague(cardLeagueId)
      : await getPaymentProvider(null);
    const providerCustId = getProviderCustomerId(bowler, provider);
    if (!providerCustId && provider.providerName !== 'cardpointe') {
      return sendError(res, 'Bowler does not have a payment customer account', 400);
    }

    const savedCard = await provider.saveCardOnFile(sourceId, providerCustId || '');
    if (!savedCard?.id) {
      return sendError(res, 'Failed to save card on file', 500);
    }

    log.info('Card saved on file (no-charge):', savedCard.id.substring(0, 15) + '...');
    await persistCardpointeProfile(provider, savedCard.id, bowlerId);
    return sendSuccess(res, { savedCardId: savedCard.id, last4: savedCard.last4, brand: savedCard.brand });
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return sendError(res, 'Payment provider not configured for this location', 422, 'PROVIDER_NOT_CONFIGURED');
    }
    log.error('Save card error:', error);
    return sendError(res, 'Failed to save card');
  }
});

router.get('/cards/:bowlerId', async (req, res) => {
  try {
    const bowlerId = parseInt(req.params.bowlerId);
    if (isNaN(bowlerId)) {
      return sendError(res, 'Invalid bowler ID', 400);
    }

    if (!await hasAccessToBowler(req, bowlerId)) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return sendSuccess(res, []);
    }

    const listLeagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : null;
    let resolvedLeagueId = listLeagueId;
    if (!resolvedLeagueId) {
      const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId: bowlerId });
      if (bowlerLeagues.length > 0) {
        resolvedLeagueId = bowlerLeagues[0].leagueId;
      }
    }

    let provider;
    try {
      provider = resolvedLeagueId
        ? await getProviderForLeague(resolvedLeagueId)
        : await getPaymentProvider(null);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        log.warn('List cards: provider not configured, returning empty', { leagueId: resolvedLeagueId });
        return sendSuccess(res, []);
      }
      throw e;
    }

    const providerCustId = getProviderCustomerId(bowler, provider);
    if (!providerCustId) {
      return sendSuccess(res, []);
    }

    const cards = await provider.listCardsOnFile(providerCustId);
    sendSuccess(res, cards);
  } catch (error) {
    log.error('List cards error:', error);
    sendError(res, 'Failed to list cards');
  }
});

router.delete('/cards/:bowlerId/:cardId', async (req, res) => {
  try {
    const bowlerId = parseInt(req.params.bowlerId);
    if (isNaN(bowlerId)) {
      return sendError(res, 'Invalid bowler ID', 400);
    }

    const { cardId } = req.params;
    if (!cardId || typeof cardId !== 'string') {
      return sendError(res, 'Invalid card ID', 400);
    }

    if (!await hasAccessToBowler(req, bowlerId)) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const bowler = await storage.getBowler(bowlerId);
    if (!bowler) {
      return sendError(res, 'Bowler not found', 404);
    }

    const delLeagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : null;
    let resolvedLeagueId = delLeagueId;
    if (!resolvedLeagueId) {
      const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId: bowlerId });
      if (bowlerLeagues.length > 0) {
        resolvedLeagueId = bowlerLeagues[0].leagueId;
      }
    }

    const provider = resolvedLeagueId
      ? await getProviderForLeague(resolvedLeagueId)
      : await getPaymentProvider(null);

    const providerCustId = getProviderCustomerId(bowler, provider);
    if (!providerCustId) {
      return sendError(res, 'Bowler does not have a payment customer account', 400);
    }

    await provider.disableCard(cardId, providerCustId);
    log.info('Card disabled:', cardId.substring(0, 15) + '...');
    sendSuccess(res, { disabled: true });
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return sendError(res, 'Payment provider not configured for this location', 422, 'PROVIDER_NOT_CONFIGURED');
    }
    const message = error instanceof Error ? error.message : 'Failed to remove card';
    log.error('Disable card error:', message);
    sendError(res, message, message.includes('does not belong') ? 403 : 500);
  }
});

router.post('/apple-pay/register-all-domains', async (req: any, res) => {
  try {
    if (req.user?.role !== 'system_admin') {
      return sendError(res, 'System admin access required', 403, 'FORBIDDEN');
    }

    const organizations = await storage.getOrganizations();
    const results: { domain: string; success: boolean; message: string }[] = [];

    for (const org of organizations) {
      const domain = org.subdomain || org.slug;
      if (!domain) continue;

      const fullDomain = `${domain}.leaguevault.app`;
      const orgLeagues = await storage.getLeagues(org.id);
      const locationIds = new Set<number>();
      for (const league of orgLeagues) {
        if (league.locationId) locationIds.add(league.locationId);
      }

      if (locationIds.size === 0) {
        results.push({ domain: fullDomain, success: false, message: 'No locations with payment credentials' });
        continue;
      }

      for (const locationId of locationIds) {
        try {
          const provider = await getPaymentProvider(locationId);
          if (hasWalletSupport(provider)) {
            const result = await provider.registerApplePayDomain(fullDomain);
            results.push({ domain: fullDomain, ...result });
          } else {
            results.push({ domain: fullDomain, success: false, message: 'Provider does not support Apple Pay' });
          }
        } catch (e) {
          if (e instanceof ProviderNotConfiguredError) {
            results.push({ domain: fullDomain, success: false, message: 'Payment provider not configured' });
          } else {
            throw e;
          }
        }
      }
    }

    const registered = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    log.info(`Apple Pay bulk registration: ${registered} succeeded, ${failed} failed`);
    sendSuccess(res, { results, registered, failed });
  } catch (error) {
    log.error('Apple Pay bulk registration error:', error);
    sendError(res, 'Failed to bulk register domains', 500);
  }
});

router.post('/apple-pay/register-domain', async (req: any, res) => {
  try {
    if (req.user?.role !== 'system_admin' && req.user?.role !== 'org_admin') {
      return sendError(res, 'Admin access required', 403, 'FORBIDDEN');
    }

    const { domain, locationId } = req.body;
    if (!domain || typeof domain !== 'string') {
      return sendError(res, 'Domain is required', 400, 'VALIDATION_ERROR');
    }

    if (req.user.role === 'org_admin' && req.user.organizationId) {
      const org = await storage.getOrganization(req.user.organizationId);
      if (org) {
        const orgDomain = org.subdomain || org.slug;
        const expectedDomain = `${orgDomain}.leaguevault.app`;
        if (domain !== expectedDomain) {
          return sendError(res, 'Domain does not match your organization', 403, 'FORBIDDEN');
        }
      }

      if (locationId) {
        const location = await storage.getLocation(parseInt(locationId));
        if (!location || location.organizationId !== req.user.organizationId) {
          return sendError(res, 'Location does not belong to your organization', 403, 'FORBIDDEN');
        }
      }
    }

    const lvLocationId = locationId ? parseInt(locationId) : null;
    let provider;
    try {
      provider = await getPaymentProvider(lvLocationId);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        return sendError(res, 'Payment provider not configured for this location', 422, 'PROVIDER_NOT_CONFIGURED');
      }
      throw e;
    }
    if (!hasWalletSupport(provider)) {
      return sendError(res, 'Payment provider does not support Apple Pay', 400, 'UNSUPPORTED_FEATURE');
    }

    const result = await provider.registerApplePayDomain(domain);

    if (result.success) {
      sendSuccess(res, result);
    } else {
      sendError(res, result.message, 400, 'REGISTRATION_FAILED');
    }
  } catch (error) {
    log.error('Apple Pay domain registration error:', error);
    sendError(res, 'Failed to register domain for Apple Pay', 500);
  }
});

router.get('/config', async (req: any, res) => {
  const locationIdParam = req.query.locationId as string | undefined;
  if (locationIdParam) {
    const lvLocationId = parseInt(locationIdParam);
    if (!isNaN(lvLocationId)) {
      try {
        const loc = await storage.getLocation(lvLocationId);
        if (loc) {
          const isAuthorized =
            req.user?.role === 'system_admin' ||
            (req.user?.organizationId != null && req.user.organizationId === loc.organizationId);
          if (isAuthorized) {
            if (loc.paymentProvider === 'cardpointe') {
              const cpCreds = await storage.getLocationCardPointeConfig(lvLocationId);
              if (cpCreds?.merchantId && cpCreds.merchantId.trim().length > 0 && cpCreds.siteUrl && cpCreds.siteUrl.trim().length > 0) {
                return res.json({
                  paymentProvider: 'cardpointe',
                  tokenizerUrl: `https://${cpCreds.siteUrl.replace(/^https?:\/\//, '')}/itoke/ajax-tokenizer.html`,
                });
              }
            }

            const creds = await storage.getLocationSquareConfig(lvLocationId);
            if (creds?.appId && creds?.accessToken && creds.appId.trim().length > 0) {
              return res.json({
                appId: creds.appId.trim(),
                locationId: creds.locationId?.trim() || '',
                paymentProvider: loc.paymentProvider ?? 'square',
              });
            }
          }
        }
      } catch {
        // fall through to env-var config
      }
    }
  }

  const prodAppId = process.env.SQUARE_PRODUCTION_APP_ID || '';
  const viteAppId = process.env.VITE_SQUARE_APP_ID || '';
  const squareAppId = process.env.SQUARE_APP_ID || '';

  const appId = prodAppId
    || ((viteAppId && !viteAppId.includes('sandbox-')) ? viteAppId : '')
    || ((squareAppId && !squareAppId.includes('sandbox-')) ? squareAppId : '')
    || viteAppId || squareAppId;

  if (isDev) log.info('Serving config:', {
    prodAppIdSet: !!prodAppId,
    viteAppIdSet: !!viteAppId,
    squareAppIdSet: !!squareAppId,
    selectedAppId: appId.substring(0, 10) + '...',
    isProduction: appId.length > 0 && !appId.includes('sandbox-'),
  });

  const squareLocationId = process.env.SQUARE_LOCATION_ID || process.env.VITE_SQUARE_LOCATION_ID || '';
  res.json({ appId, locationId: squareLocationId, paymentProvider: 'square' });
});

export default router;
