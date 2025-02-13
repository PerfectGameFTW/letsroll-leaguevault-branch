import type { Express } from "express";
import { createServer, type Server } from "http";
import leaguesRouter from './routes/leagues';
import teamsRouter from './routes/teams';
import bowlersRouter from './routes/bowlers';
import bowlerLeaguesRouter from './routes/bowler-leagues';
import paymentsRouter from './routes/payments';
import scoresRouter from './routes/scores';
import gamesRouter from './routes/games';
import { storage } from "./storage";
import { ApiError, Client, Environment } from 'square';
import { sendSuccess, sendError } from './utils/api';
import { testConnection } from './db';

let squareClient: Client | null = null;
if (process.env.SQUARE_ACCESS_TOKEN) {
  squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: 'sandbox' as Environment,
  });
}

export function registerRoutes(app: Express): Server {
  console.log('[Routes] Registering API routes...');

  // Add health check endpoint
  app.get('/api/health', async (req, res) => {
    try {
      await testConnection();
      sendSuccess(res, { status: 'healthy', database: 'connected' });
    } catch (error) {
      sendError(res, 'Database connection failed', 500);
    }
  });

  // Register route modules
  app.use('/api/leagues', leaguesRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/bowlers', bowlersRouter);
  app.use('/api/bowler-leagues', bowlerLeaguesRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/scores', scoresRouter);
  app.use('/api/games', gamesRouter);

  console.log('[Routes] API routes registered');

  // Create and return the server instance
  return createServer(app);
}

async function handleSquareCustomer(bowler: {
  id: number;
  name: string;
  email: string;
  active: boolean;
  squareCustomerId: string | null;
}): Promise<string | null> {
  if (!squareClient) return null;

  try {
    console.log('[Square] Searching for customer:', bowler.email);
    const searchResponse = await squareClient.customersApi.searchCustomers({
      query: {
        filter: {
          emailAddress: {
            exact: bowler.email.toLowerCase()
          }
        }
      }
    });

    let customerId: string;

    if (searchResponse.result.customers?.[0]?.id) {
      customerId = searchResponse.result.customers[0].id;
      console.log('[Square] Updating existing customer:', customerId);

      await squareClient.customersApi.updateCustomer(customerId, {
        givenName: bowler.name.split(' ')[0],
        familyName: bowler.name.split(' ').slice(1).join(' ') || '',
        emailAddress: bowler.email.toLowerCase(),
      });
    } else {
      console.log('[Square] Creating new customer');
      const customerResponse = await squareClient.customersApi.createCustomer({
        idempotencyKey: `${Date.now()}-${Math.random()}`,
        givenName: bowler.name.split(' ')[0],
        familyName: bowler.name.split(' ').slice(1).join(' ') || '',
        emailAddress: bowler.email.toLowerCase(),
      });

      if (!customerResponse.result?.customer?.id) {
        throw new Error('Failed to create Square customer');
      }

      customerId = customerResponse.result.customer.id;
      console.log('[Square] Created new customer:', customerId);
    }

    return customerId;
  } catch (error) {
    console.error('[Square] Error handling customer:', error);
    throw error;
  }
}

export { handleSquareCustomer };