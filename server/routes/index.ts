import type { Express } from "express";
import { createServer, type Server } from "http";
import leaguesRouter from './leagues.js';
import teamsRouter from './teams.js';
import bowlersRouter from './bowlers.js';
import paymentsRouter from './payments.js';
import bowlerLeaguesRouter from './bowler-leagues.js';
import bowlerLeaguesNewRouter from './bowler-leagues-new.js'; // Add new improved BowlerLeagues router
import scoresRouter from './scores.js';
import gamesRouter from './games.js';
import squareRouter from './square.js';  // Add Square router import
import adminRouter from './admin.js';    // Add Admin router import
import organizationsRouter from './organizations.js'; // Add Organizations router import
import orgAdminRouter from './organization-admin.js'; // Add Organization Admin router import
import { testConnection } from '../db.js';
import { sendSuccess, sendError } from '../utils/api.js';

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
  app.use('/api/bowler-leagues-new', bowlerLeaguesNewRouter); // Register the new BowlerLeagues route
  app.use('/api/payments', paymentsRouter);
  app.use('/api/scores', scoresRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api/square', squareRouter);  // Register Square routes
  app.use('/api/admin', adminRouter);    // Register Admin routes
  app.use('/api/organizations', organizationsRouter); // Register Organizations routes
  app.use('/api/org-admin', orgAdminRouter); // Register Organization Admin routes

  console.log('[Routes] API routes registered');
  return server;
}