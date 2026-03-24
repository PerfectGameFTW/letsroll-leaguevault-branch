import { Router } from 'express';
import crypto from 'crypto';
import { processPayment, createOrUpdateCustomer, listCatalogItems, listCatalogCategories, createOrderWithPayment, saveCardOnFile, listCardsOnFile, disableCard, registerApplePayDomain, getSquarePayment } from '../services/square.js';
import { getEffectiveBowlingWeeks } from '@shared/schedule-utils';
import { storage } from '../storage';
import { sendSuccess, sendError } from '../utils/api.js';
import { hasAccessToLeague, hasAccessToBowler } from '../utils/access-control.js';
import { squarePaymentLimiter } from '../middleware/rate-limit.js';
import { createLogger } from '../logger';

const log = createLogger("Square");

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

    if (!dbPayment.squarePaymentId) {
      return res.json({
        dbPayment: { id: dbPayment.id, amount: dbPayment.amount, status: dbPayment.status, type: dbPayment.type, createdAt: dbPayment.createdAt },
        squarePayment: null,
        message: 'No Square payment ID associated with this payment (cash/check payment)',
      });
    }

    const league = await storage.getLeague(dbPayment.leagueId);
    const locationId = league?.locationId ?? null;

    const squarePayment = await getSquarePayment(dbPayment.squarePaymentId, locationId);

    log.info('Payment verification:', {
      dbPaymentId: dbPayment.id,
      squarePaymentId: dbPayment.squarePaymentId,
      squareFound: !!squarePayment,
      squareStatus: squarePayment?.status,
      dbStatus: dbPayment.status,
    });

    res.json({
      dbPayment: {
        id: dbPayment.id,
        amount: dbPayment.amount,
        status: dbPayment.status,
        type: dbPayment.type,
        squarePaymentId: dbPayment.squarePaymentId,
        createdAt: dbPayment.createdAt,
        bowlerId: dbPayment.bowlerId,
        leagueId: dbPayment.leagueId,
      },
      squarePayment,
      match: squarePayment ? {
        statusMatch: (dbPayment.status === 'paid' && squarePayment.status === 'COMPLETED') ||
                     (dbPayment.status !== 'paid' && squarePayment.status !== 'COMPLETED'),
        amountMatch: String(dbPayment.amount) === squarePayment.amountMoney.amount,
      } : null,
      message: squarePayment
        ? `Square payment found: ${squarePayment.status}, $${(parseInt(squarePayment.amountMoney.amount) / 100).toFixed(2)}`
        : 'Square payment NOT found — payment may have failed or been processed under different credentials',
    });
  } catch (error: any) {
    log.error('Payment verification error:', error);
    sendError(res, 'Failed to verify payment', 500);
  }
});

router.post('/payments', squarePaymentLimiter, async (req: any, res) => {
  try {
    const { sourceId, amount, bowlerId, leagueId } = req.body;

    log.info('Payment request received:', {
      bowlerId,
      leagueId,
      amount,
      sourceIdPrefix: sourceId?.substring(0, 10) + '...',
      storeCard: req.body.storeCard,
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
    // Square limits idempotency_key to 45 chars; service appends "-order" (6) or "-pay" (4),
    // so truncate the base key to 39 chars to stay within the limit in all cases.
    const squareIdempotencyKey = idempotencyKey.substring(0, 39);
    if (existingPayment) {
      log.info('Payment deduplicated (same token resubmitted):', { dbPaymentId: existingPayment.id, squarePaymentId: existingPayment.squarePaymentId, bowlerId, leagueId, amount });
      return res.json({ dbPaymentId: existingPayment.id, id: existingPayment.squarePaymentId, status: 'COMPLETED', deduplicated: true });
    }

    let payment;
    let storedCardId: string | undefined;

    const lvLocationId = league.locationId ?? null;
    const customerId = bowler.squareCustomerId || undefined;

    if (req.body.storeCard && !customerId) {
      log.warn('Cannot store card — bowler has no Square customer ID:', bowlerId);
    }

    const lineItems: { catalogObjectId: string; quantity: string }[] = [];
    const weeklyFee = league.weeklyFee || 0;
    const quantity = weeklyFee > 0 && amount % weeklyFee === 0
      ? String(amount / weeklyFee)
      : '1';
    if (league?.squareLineageItemVariationId) {
      lineItems.push({ catalogObjectId: league.squareLineageItemVariationId, quantity });
    }
    if (league?.squarePrizeFundItemVariationId) {
      lineItems.push({ catalogObjectId: league.squarePrizeFundItemVariationId, quantity });
    }

    const buyerEmail = bowler.email || undefined;

    log.info('Processing Square payment:', {
      bowlerId, leagueId, amount,
      locationId: lvLocationId,
      hasLineItems: lineItems.length > 0,
      hasCustomerId: !!customerId,
    });

    if (lineItems.length > 0) {
      payment = await createOrderWithPayment(
        sourceId,
        amount,
        lineItems,
        lvLocationId,
        req.body.storeCard,
        customerId,
        buyerEmail,
        squareIdempotencyKey
      );
    } else {
      payment = await processPayment(
        sourceId,
        amount,
        req.body.storeCard,
        customerId,
        buyerEmail,
        squareIdempotencyKey,
        lvLocationId
      );
    }

    log.info('Square payment completed:', {
      squarePaymentId: payment.id,
      squareStatus: payment.status,
      bowlerId, leagueId, amount,
    });

    if (req.body.storeCard && customerId && sourceId && !sourceId.startsWith('ccof:')) {
      try {
        const savedCard = await saveCardOnFile(sourceId, customerId, lvLocationId);
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
            log.info('No payment schedule to update (normal for one-time payments)');
          }
        }
      } catch (error) {
        log.error('Failed to save card on file:', error);
      }
    }

    const lineageAmount = (league.lineageFee != null && league.weeklyFee > 0)
      ? Math.round(amount * league.lineageFee / league.weeklyFee)
      : undefined;
    const prizeFundAmount = (league.prizeFundFee != null && league.weeklyFee > 0)
      ? Math.round(amount * league.prizeFundFee / league.weeklyFee)
      : undefined;

    const dbPayment = await storage.createPayment({
      bowlerId,
      leagueId,
      amount,
      lineageAmount,
      prizeFundAmount,
      weekOf: weekOf.toISOString(),
      status: 'paid',
      type: 'credit_card',
      squarePaymentId: payment.id,
      idempotencyKey,
    });

    log.info('Payment recorded in DB:', {
      dbPaymentId: dbPayment.id,
      squarePaymentId: payment.id,
      bowlerId, leagueId, amount,
    });

    res.json({
      ...payment,
      dbPaymentId: dbPayment.id,
      savedCardId: storedCardId ?? null,
    });
  } catch (error: any) {
    const errDetail = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    } : error;
    const squareErrors = error?.errors || error?.body?.errors;
    log.error('Payment processing error:', { error: errDetail, squareErrors });
    let userMessage = 'Payment processing failed. Please try again.';
    if (squareErrors?.[0]?.detail) {
      userMessage = squareErrors[0].detail;
    } else if (error instanceof Error && error.message.startsWith('{')) {
      try {
        const parsed = JSON.parse(error.message);
        userMessage = parsed.error?.message || userMessage;
      } catch {}
    }
    return sendError(res, userMessage, 500, 'PAYMENT_ERROR');
  }
});

router.post('/customers', squarePaymentLimiter, async (req, res) => {
  try {
    // If a team ID is provided, verify the user has access to it
    if (req.body.teamId) {
      const team = await storage.getTeam(req.body.teamId);
      
      if (!team) {
        return sendError(res, "Team not found", 404, 'NOT_FOUND');
      }
      
      // Check if user has access to this team's league
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

    // Derive location ID from league context if available
    const teamLvLocationId = req.body.teamId
      ? (await storage.getLeague((await storage.getTeam(req.body.teamId))?.leagueId ?? 0))?.locationId ?? null
      : null;

    const customer = await createOrUpdateCustomer(
      req.body.name,
      req.body.email,
      undefined,
      teamLvLocationId
    );

    if (!customer) {
      throw new Error('Failed to create/update customer');
    }

    res.json(customer);
  } catch (error) {
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

    // Authorization: verify the requesting user has access to this location's org
    if (lvLocationId && !isNaN(lvLocationId)) {
      const loc = await storage.getLocation(lvLocationId);
      if (!loc) return sendError(res, 'Location not found', 404, 'NOT_FOUND');
      const isAuthorized =
        req.user?.role === 'system_admin' ||
        (req.user?.organizationId != null && req.user.organizationId === loc.organizationId);
      if (!isAuthorized) return sendError(res, 'Forbidden', 403, 'FORBIDDEN');
    }

    const categories = await listCatalogCategories(lvLocationId);
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

    // Authorization: verify the requesting user has access to this location's org
    if (lvLocationId && !isNaN(lvLocationId)) {
      const loc = await storage.getLocation(lvLocationId);
      if (!loc) return sendError(res, 'Location not found', 404, 'NOT_FOUND');
      const isAuthorized =
        req.user?.role === 'system_admin' ||
        (req.user?.organizationId != null && req.user.organizationId === loc.organizationId);
      if (!isAuthorized) return sendError(res, 'Forbidden', 403, 'FORBIDDEN');
    }

    const items = await listCatalogItems(categoryId, lvLocationId);
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
    if (!bowler?.squareCustomerId) {
      return sendError(res, 'Bowler does not have a Square customer account', 400);
    }

    // Derive location from optional leagueId context
    const cardLeagueId = req.body.leagueId ? parseInt(req.body.leagueId) : null;
    const cardLeague = cardLeagueId ? await storage.getLeague(cardLeagueId) : null;
    const cardLvLocationId = cardLeague?.locationId ?? null;

    const savedCard = await saveCardOnFile(sourceId, bowler.squareCustomerId, cardLvLocationId);
    if (!savedCard?.id) {
      return sendError(res, 'Failed to save card on file', 500);
    }

    log.info('Card saved on file (no-charge):', savedCard.id.substring(0, 15) + '...');
    return sendSuccess(res, { savedCardId: savedCard.id, last4: savedCard.last4, brand: savedCard.brand });
  } catch (error) {
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
    if (!bowler?.squareCustomerId) {
      return sendSuccess(res, []);
    }

    // Derive location from optional leagueId query param
    const listLeagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : null;
    const listLeague = listLeagueId ? await storage.getLeague(listLeagueId) : null;
    const listLvLocationId = listLeague?.locationId ?? null;

    const cards = await listCardsOnFile(bowler.squareCustomerId, listLvLocationId);
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
    if (!bowler?.squareCustomerId) {
      return sendError(res, 'Bowler does not have a Square customer account', 400);
    }

    const delLeagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : null;
    const delLeague = delLeagueId ? await storage.getLeague(delLeagueId) : null;
    const delLvLocationId = delLeague?.locationId ?? null;

    await disableCard(cardId, bowler.squareCustomerId, delLvLocationId);
    log.info('Card disabled:', cardId.substring(0, 15) + '...');
    sendSuccess(res, { disabled: true });
  } catch (error) {
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
      const leagues = await storage.getLeagues(org.id);
      const locationIds = new Set<number>();
      for (const league of leagues) {
        if (league.locationId) locationIds.add(league.locationId);
      }

      if (locationIds.size === 0) {
        results.push({ domain: fullDomain, success: false, message: 'No locations with Square credentials' });
        continue;
      }

      for (const locationId of locationIds) {
        const result = await registerApplePayDomain(fullDomain, locationId);
        results.push({ domain: fullDomain, ...result });
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
    const result = await registerApplePayDomain(domain, lvLocationId);

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
  // Attempt per-location config if locationId is supplied
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
            const creds = await storage.getLocationSquareConfig(lvLocationId);
            if (creds?.appId && creds?.accessToken && creds.appId.trim().length > 0) {
              return res.json({ appId: creds.appId.trim(), locationId: creds.locationId?.trim() || '' });
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

  log.info('Serving config:', {
    prodAppIdSet: !!prodAppId,
    viteAppIdSet: !!viteAppId,
    squareAppIdSet: !!squareAppId,
    selectedAppId: appId.substring(0, 10) + '...',
    isProduction: appId.length > 0 && !appId.includes('sandbox-'),
  });

  const locationId = process.env.SQUARE_LOCATION_ID || process.env.VITE_SQUARE_LOCATION_ID || '';
  res.json({ appId, locationId });
});

export default router;