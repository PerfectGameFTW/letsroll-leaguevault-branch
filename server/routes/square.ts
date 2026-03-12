import { Router } from 'express';
import crypto from 'crypto';
import { processPayment, createOrUpdateCustomer, listCatalogItems, listCatalogCategories, createOrderWithPayment, saveCardOnFile, listCardsOnFile } from '../services/square.js';
import { storage } from '../storage.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { hasAccessToLeague, hasAccessToBowler } from '../utils/access-control.js';

const router = Router();

router.use((req: any, res: any, next: any) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return sendError(res, "Authentication required", 401, 'UNAUTHORIZED');
  }
  next();
});

router.post('/payments', async (req: any, res) => {
  try {
    const { sourceId, amount, bowlerId, leagueId } = req.body;

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
    const totalWeeks = Math.max(1, Math.ceil((seasonEnd.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    const fullSeasonAmount = league.weeklyFee * totalWeeks;

    const existingPayments = await storage.getPayments(bowlerId, leagueId);
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
      .update(`${bowlerId}:${leagueId}:${amount}:${weekOf.toISOString().split('T')[0]}`)
      .digest('hex');

    const existingPayment = await storage.getPaymentByIdempotencyKey(idempotencyKey);
    if (existingPayment) {
      return res.json({ dbPaymentId: existingPayment.id, id: existingPayment.squarePaymentId, deduplicated: true });
    }

    let payment;
    const squareLocationId = process.env.SQUARE_PRODUCTION_LOCATION_ID || process.env.VITE_SQUARE_LOCATION_ID || process.env.SQUARE_LOCATION_ID || '';

    const customerId = bowler.squareCustomerId || undefined;

    if (req.body.storeCard && !customerId) {
      console.warn('[Square Routes] Cannot store card — bowler has no Square customer ID:', bowlerId);
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

    if (lineItems.length > 0 && squareLocationId) {
      payment = await createOrderWithPayment(
        sourceId,
        amount,
        lineItems,
        squareLocationId,
        req.body.storeCard,
        customerId,
        buyerEmail,
        idempotencyKey
      );
    } else {
      payment = await processPayment(
        sourceId,
        amount,
        req.body.storeCard,
        customerId,
        buyerEmail,
        idempotencyKey
      );
    }

    if (req.body.storeCard && customerId && sourceId && !sourceId.startsWith('ccof:')) {
      try {
        const savedCard = await saveCardOnFile(sourceId, customerId);
        if (savedCard?.id) {
          console.log('[Square Routes] Card saved on file:', savedCard.id.substring(0, 15) + '...');
          try {
            await storage.updatePaymentScheduleCard(
              bowlerId,
              leagueId,
              savedCard.id
            );
          } catch (schedError) {
            console.log('[Square Routes] No payment schedule to update (normal for one-time payments)');
          }
        }
      } catch (error) {
        console.error('[Square Routes] Failed to save card on file:', error);
      }
    }

    const dbPayment = await storage.createPayment({
      bowlerId,
      leagueId,
      amount,
      weekOf,
      status: 'paid',
      type: 'credit_card',
      squarePaymentId: payment.id,
      idempotencyKey,
    });

    res.json({
      ...payment,
      dbPaymentId: dbPayment.id
    });
  } catch (error) {
    console.error('[Square Routes] Payment processing error:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });
    res.status(500).send(error instanceof Error ? error.message : 'Payment processing failed');
  }
});

router.post('/customers', async (req, res) => {
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
        req.user?.isAdmin || 
        league.organizationId === null || 
        (req.user?.organizationId === league.organizationId);
      
      if (!userHasAccess) {
        return sendError(res, "You don't have access to this team", 403, 'FORBIDDEN');
      }
    }

    const customer = await createOrUpdateCustomer(
      req.body.name,
      req.body.email
    );

    if (!customer) {
      throw new Error('Failed to create/update customer');
    }

    res.json(customer);
  } catch (error) {
    console.error('[Square Routes] Customer operation error:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });
    res.status(500).send(error instanceof Error ? error.message : 'Customer operation failed');
  }
});

router.get('/catalog/categories', async (req, res) => {
  try {
    const categories = await listCatalogCategories();
    sendSuccess(res, categories);
  } catch (error) {
    console.error('[Square Routes] Catalog categories error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch catalog categories');
  }
});

router.get('/catalog/items', async (req, res) => {
  try {
    const categoryId = req.query.categoryId as string | undefined;
    const items = await listCatalogItems(categoryId);
    sendSuccess(res, items);
  } catch (error) {
    console.error('[Square Routes] Catalog list error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch catalog items');
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

    const cards = await listCardsOnFile(bowler.squareCustomerId);
    sendSuccess(res, cards);
  } catch (error) {
    console.error('[Square Routes] List cards error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to list cards');
  }
});

router.get('/config', (_req, res) => {
  const prodAppId = process.env.SQUARE_PRODUCTION_APP_ID || '';
  const viteAppId = process.env.VITE_SQUARE_APP_ID || '';
  const squareAppId = process.env.SQUARE_APP_ID || '';

  const prodLocationId = process.env.SQUARE_PRODUCTION_LOCATION_ID || '';
  const viteLocationId = process.env.VITE_SQUARE_LOCATION_ID || '';
  const squareLocationId = process.env.SQUARE_LOCATION_ID || '';

  const appId = prodAppId
    || ((viteAppId && !viteAppId.includes('sandbox-')) ? viteAppId : '')
    || ((squareAppId && !squareAppId.includes('sandbox-')) ? squareAppId : '')
    || viteAppId || squareAppId;

  const locationId = prodLocationId || viteLocationId || squareLocationId;

  console.log('[Square Config] Serving config:', {
    prodAppIdSet: !!prodAppId,
    viteAppIdSet: !!viteAppId,
    squareAppIdSet: !!squareAppId,
    selectedAppId: appId.substring(0, 10) + '...',
    isProduction: appId.length > 0 && !appId.includes('sandbox-'),
  });

  res.json({ appId, locationId });
});

export default router;