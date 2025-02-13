import type { Express } from "express";
import { createServer, type Server } from "http";
import leaguesRouter from './routes/leagues';
import teamsRouter from './routes/teams';
import bowlersRouter from './routes/bowlers';
import bowlerLeaguesRouter from './routes/bowler-leagues';
import paymentsRouter from './routes/payments';
import { storage } from "./storage";
import { insertBowlerSchema, insertPaymentSchema, insertLeagueSchema, insertTeamSchema, insertBowlerLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { ApiResponse, ApiListResponse } from "@shared/schema";
import { ApiError, Client, Environment } from 'square';
import { sendSuccess, sendError } from './utils/api';

interface Bowler {
  id: number;
  name: string;
  email: string;
  active: boolean;
  squareCustomerId: string | null;
  order: number;
}

let squareClient: Client | null = null;
if (process.env.SQUARE_ACCESS_TOKEN) {
  squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: 'sandbox' as Environment,
  });
}

export function registerRoutes(app: Express): Server {
  console.log('[Routes] Registering API routes...');

  // Register route modules
  app.use('/api/leagues', leaguesRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/bowlers', bowlersRouter);
  app.use('/api/bowler-leagues', bowlerLeaguesRouter); // Ensure this route is registered
  app.use('/api/payments', paymentsRouter);

  // Create and return the server instance without starting it
  return createServer(app);
}

async function updateBowler(id: number, update: {
  name?: string;
  email?: string;
  active?: boolean;
  squareCustomerId?: string | null;
  order?: number;
}): Promise<Bowler> {
  const bowler = await storage.getBowler(id);
  if (!bowler) {
    throw new Error("Bowler not found");
  }

  const updated = await storage.updateBowler(id, update);
  if (!updated) {
    throw new Error("Failed to update bowler");
  }

  return updated;
}

async function handleSquareCustomer(bowler: Bowler): Promise<string | null> {
  if (!squareClient) return null;

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

    await squareClient.customersApi.updateCustomer(customerId, {
      givenName: bowler.name.split(' ')[0],
      familyName: bowler.name.split(' ').slice(1).join(' ') || '',
      emailAddress: bowler.email.toLowerCase(),
    });
  } else {
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
  }

  return customerId;
}