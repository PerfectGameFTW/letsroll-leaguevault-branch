import type { Express } from "express";
import { createServer, type Server } from "http";
import leaguesRouter from './leagues';
import teamsRouter from './teams';
import bowlersRouter from './bowlers';
import paymentsRouter from './payments';
import bowlerLeaguesRouter from './bowler-leagues';
import importRouter from './import'; // Add import router
import { testConnection } from '../db';
import { sendSuccess, sendError } from '../utils/api';

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
  app.use('/api/import', importRouter); // Add the import router

  console.log('[Routes] API routes registered');

  // Catch-all middleware for unhandled routes
  app.use('/api/*', (req, res) => {
    console.log('[Routes] Unhandled API route:', req.method, req.path);
    sendError(res, 'Endpoint not found', 404);
  });

  const httpServer = createServer(app);
  return httpServer;
}