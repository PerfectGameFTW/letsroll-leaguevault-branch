import type { Express } from "express";
import { Router } from "express";
import leaguesRouter from './leagues.js';
import teamsRouter from './teams.js';
import bowlersRouter from './bowlers.js';
import paymentsRouter from './payments.js';
import bowlerLeaguesRouter from './bowler-leagues.js';
import scoresRouter from './scores.js';
import gamesRouter from './games.js';
import squareRouter from './square.js';
import adminRouter from './admin.js';
import adminUpdateRouter from './admin-update.js';
import organizationsRouter from './organizations.js';
import orgAdminRouter from './organization-admin.js';
import userBowlersRouter from './user-bowlers.js';
import setupAdminRouter from './setup-admin.js';
import systemAdminRouter from './system-admin.js';
import userAvatarRouter from './user-avatar.js';
import userUpdateRouter from './user-update.js';
import locationsRouter from './locations.js';
import paymentSchedulesRouter from './payment-schedules.js';
import bowlnowRouter from './bowlnow.js';

export function registerRoutes(app: Express): void {
  console.log('[Routes] Registering API routes...');

  app.get('/api/user', (req, res) => {
    req.url = '/api/auth/user';
    app._router.handle(req, res);
  });

  app.post('/api/logout', (req, res) => {
    req.url = '/api/auth/logout';
    app._router.handle(req, res);
  });

  app.use('/api/leagues', leaguesRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/bowlers', bowlersRouter);
  app.use('/api/bowler-leagues', bowlerLeaguesRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/scores', scoresRouter);
  app.use('/api/games', gamesRouter);
  app.use('/api/square', squareRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/admin-update', adminUpdateRouter);
  app.use('/api/organizations', organizationsRouter);
  app.use('/api/org-admin', orgAdminRouter);
  app.use('/api/user-bowlers', userBowlersRouter);
  app.use('/api/setup', setupAdminRouter);
  app.use('/api/system-admin', systemAdminRouter);
  app.use('/api/user', userAvatarRouter);
  app.use('/api/user-update', userUpdateRouter);
  app.use('/api/locations', locationsRouter);
  app.use('/api/payment-schedules', paymentSchedulesRouter);
  app.use('/api/bn', bowlnowRouter);

  console.log('[Routes] API routes registered');
}
