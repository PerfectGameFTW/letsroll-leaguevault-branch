import { Router } from 'express';
import { processPayment, createOrUpdateCustomer } from '../services/square.js';
import { storage } from '../storage.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { hasAccessToLeague, hasAccessToBowler } from '../utils/access-control.js';

const router = Router();

router.post('/payments', async (req, res) => {
  try {
    // Verify that the user has access to the league
    if (!await hasAccessToLeague(req, req.body.leagueId)) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    // Verify that the user has access to the bowler
    if (!await hasAccessToBowler(req, req.body.bowlerId)) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const payment = await processPayment(
      req.body.sourceId,
      req.body.amount,
      req.body.storeCard
    );

    // If this is for a recurring payment schedule and we have a card on file,
    // update the schedule with the new card token
    if (req.body.storeCard && payment.cardOnFile && payment.cardOnFile.id) {
      try {
        await storage.updatePaymentScheduleCard(
          req.body.bowlerId,
          req.body.leagueId,
          payment.cardOnFile.id
        );
      } catch (error) {
        console.error('[Square Routes] Failed to update payment schedule card:', error);
        // Don't throw here, as the payment was still successful
      }
    }

    // Save payment record to database
    const dbPayment = await storage.createPayment({
      bowlerId: req.body.bowlerId,
      leagueId: req.body.leagueId,
      amount: req.body.amount,
      weekOf: new Date(),
      status: 'paid',
      type: 'credit_card',
      squarePaymentId: payment.id
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

// Add a debugging route to check Square environment
router.get('/config', (req, res) => {
  try {
    // Don't expose actual tokens, just show detection results
    const accessToken = process.env.SQUARE_ACCESS_TOKEN || '';
    const appId = process.env.VITE_SQUARE_APP_ID || '';
    const locationId = process.env.VITE_SQUARE_LOCATION_ID || '';
    
    // Determine environment based on token format 
    const isProductionToken = accessToken.startsWith('EAAAEv') || accessToken.startsWith('EAAAl7');
    const isProductionAppId = !appId.includes('sandbox-');
    
    // Send back environment details without revealing secrets
    sendSuccess(res, {
      environment: {
        tokenFormat: isProductionToken ? 'PRODUCTION' : 'SANDBOX',
        appIdFormat: isProductionAppId ? 'PRODUCTION' : 'SANDBOX', 
        nodeEnv: process.env.NODE_ENV || 'development'
      },
      credentials: {
        hasAccessToken: !!accessToken,
        hasAppId: !!appId,
        hasLocationId: !!locationId
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Square Routes] Error checking environment:', error);
    sendError(res, 'Error checking Square environment');
  }
});

export default router;