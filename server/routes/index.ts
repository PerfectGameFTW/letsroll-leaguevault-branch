import type { Express } from "express";
import { createServer, type Server } from "http";
import leaguesRouter from './leagues';
import teamsRouter from './teams';
import bowlersRouter from './bowlers';
import paymentsRouter from './payments';
import bowlerLeaguesRouter from './bowler-leagues';
import { enrollInLoyalty, getLoyaltyPoints, createOrUpdateCustomer, addCustomerToLeagueGroup } from '../services/square';

console.log('[Routes] All routes loaded, including payments router');
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';
import { storage } from '../storage';

export function registerRoutes(app: Express): Server {
  console.log('[Routes] Registering API routes...');

  // Register route modules
  // Register specific route handlers first
  app.use('/api/leagues', leaguesRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/bowlers', bowlersRouter);
  app.use('/api/bowler-leagues', bowlerLeaguesRouter);
  app.use('/api/payments', paymentsRouter);

  console.log('[Routes] API routes registered');

  // Catch-all middleware for unhandled routes should be last
  app.use('/api/*', (req, res, next) => {
    console.log('[Routes] Unhandled API route:', req.method, req.path);
    next();
  });

  // Square customer management endpoints
  app.post("/api/square/customers", async (req, res) => {
    try {
      const { name, email, teamId } = z.object({
        name: z.string(),
        email: z.string().email(),
        teamId: z.number().optional(),
      }).parse(req.body);

      const customer = await createOrUpdateCustomer(name, email);
      if (!customer) {
        throw new Error("Failed to create/update Square customer");
      }

      if (teamId) {
        const team = await storage.getTeam(teamId);
        if (!team) {
          throw new Error("Team not found");
        }

        const league = await storage.getLeague(team.leagueId);
        if (!league) {
          throw new Error("League not found");
        }

        await addCustomerToLeagueGroup(customer.id, league.name);
      }

      sendSuccess(res, customer, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        console.error('Square customer creation error:', error);
        sendError(res, error instanceof Error ? error.message : "Failed to create Square customer", 500);
      }
    }
  });

  // Loyalty program endpoints
  app.post("/api/square/loyalty/enroll", async (req, res) => {
    try {
      const { customerId } = z.object({
        customerId: z.string(),
      }).parse(req.body);

      const result = await enrollInLoyalty(customerId);
      sendSuccess(res, result);
    } catch (error) {
      console.error('Loyalty enrollment error:', error);
      sendError(res, error instanceof Error ? error.message : "Failed to enroll in loyalty program", 500);
    }
  });

  app.get("/api/square/loyalty/points/:customerId", async (req, res) => {
    try {
      const { customerId } = req.params;
      const points = await getLoyaltyPoints(customerId);
      sendSuccess(res, points);
    } catch (error) {
      console.error('Loyalty points fetch error:', error);
      sendError(res, error instanceof Error ? error.message : "Failed to fetch loyalty points", 500);
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}