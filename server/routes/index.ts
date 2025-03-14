import type { Express } from "express";
import { createServer, type Server } from "http";
import { Router } from "express";
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
import adminUpdateRouter from './admin-update.js'; // Add Admin Update router import
import organizationsRouter from './organizations.js'; // Add Organizations router import
import orgAdminRouter from './organization-admin.js'; // Add Organization Admin router import
import userBowlersRouter from './user-bowlers.js';    // Add User-Bowlers router import
import setupAdminRouter from './setup-admin.js';      // Add Setup Admin router import
import systemAdminRouter from './system-admin.js';    // Add System Admin router import
import userAvatarRouter from './user-avatar.js';      // Add User Avatar router import
import userUpdateRouter from './user-update.js';    // Add User Update router import
import { setupAuth } from '../auth.js';  // Import the authentication setup function
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

  // Setup authentication for the application (this includes auth routes)
  // This should be called before registering other routes
  // as it sets up the auth middleware and routes
  setupAuth(app);

  // NOTE: setupAuth already adds the /api/auth/[login,register,logout,user] routes
  // so there's no need to register auth routes separately here
  
  // Add compatibility route for /api/user that forwards to /api/auth/user
  app.get('/api/user', (req, res) => {
    console.log('[Routes] Forwarding /api/user request to /api/auth/user');
    // Forward the request to the auth/user endpoint handler
    req.url = '/api/auth/user';
    app._router.handle(req, res);
  });
  
  // Add compatibility route for /api/logout that forwards to /api/auth/logout
  app.post('/api/logout', (req, res) => {
    console.log('[Routes] Forwarding /api/logout request to /api/auth/logout');
    // Forward the request to the auth/logout endpoint handler
    req.url = '/api/auth/logout';
    app._router.handle(req, res);
  });

  // Register all API routes
  app.use('/api/leagues', leaguesRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/bowlers', bowlersRouter);
  app.use('/api/bowler-leagues', bowlerLeaguesRouter);
  app.use('/api/bowler-leagues-new', bowlerLeaguesNewRouter); // Register the new BowlerLeagues route
  app.use('/api/payments', paymentsRouter);
  app.use('/api/scores', scoresRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api/square', squareRouter);   // Register Square routes
  app.use('/api/admin', adminRouter);     // Register Admin routes
  app.use('/api/admin-update', adminUpdateRouter); // Register Admin Update routes
  app.use('/api/organizations', organizationsRouter); // Register Organizations routes
  app.use('/api/org-admin', orgAdminRouter); // Register Organization Admin routes
  app.use('/api/user-bowlers', userBowlersRouter); // Register User-Bowlers routes
  app.use('/api/setup', setupAdminRouter); // Register Setup Admin routes
  app.use('/api/system-admin', systemAdminRouter); // Register System Admin routes
  app.use('/api/user', userAvatarRouter); // Register User Avatar routes for profile management
  app.use('/api/user-update', userUpdateRouter); // Register User Update routes

  console.log('[Routes] API routes registered');
  return server;
}