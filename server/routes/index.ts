import type { Express } from "express";
import { createServer, type Server } from "http";
import leaguesRouter from './leagues';
import teamsRouter from './teams';
import bowlersRouter from './bowlers';
import paymentsRouter from './payments';
import bowlerLeaguesRouter from './bowler-leagues';
import scoresRouter from './scores';
import gamesRouter from './games';
import { testConnection } from '../db';
import { sendSuccess, sendError } from '../utils/api';

export function registerRoutes(app: Express): Server {
  console.log('[Routes] Registering API routes...');

  // Create HTTP server first
  const server = createServer(app);

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

  return server;
}