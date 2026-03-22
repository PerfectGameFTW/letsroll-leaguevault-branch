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
import integrationsRouter from './integrations.js';
import { requireAuth, requireOrgAdmin, requireSystemAdmin } from '../middleware/auth.js';
import { createLogger } from '../logger';

const log = createLogger("Routes");

export function registerRoutes(app: Express): void {
  log.info('Registering API routes...');

  app.get('/api/user', (req, res) => {
    req.url = '/api/auth/user';
    app._router.handle(req, res);
  });

  app.post('/api/logout', (req, res) => {
    req.url = '/api/auth/logout';
    app._router.handle(req, res);
  });

  // All resource routers require authentication at minimum.
  // Role-specific routers (org-admin, system-admin) further restrict access.
  app.use('/api/leagues', requireAuth, leaguesRouter);
  app.use('/api/teams', requireAuth, teamsRouter);
  app.use('/api/bowlers', requireAuth, bowlersRouter);
  app.use('/api/bowler-leagues', requireAuth, bowlerLeaguesRouter);
  app.use('/api/payments', requireAuth, paymentsRouter);
  app.use('/api/scores', requireAuth, scoresRouter);
  app.use('/api/games', requireAuth, gamesRouter);
  app.use('/api/square', requireAuth, squareRouter);
  app.use('/api/admin', requireOrgAdmin, adminRouter);
  app.use('/api/admin-update', requireOrgAdmin, adminUpdateRouter);
  app.use('/api/organizations', requireAuth, organizationsRouter);
  app.use('/api/org-admin', requireOrgAdmin, orgAdminRouter);
  app.use('/api/user-bowlers', requireAuth, userBowlersRouter);
  app.use('/api/setup', setupAdminRouter); // setup routes have their own secret-based auth
  app.use('/api/system-admin', requireSystemAdmin, systemAdminRouter);
  app.use('/api/user', requireAuth, userAvatarRouter);
  app.use('/api/user-update', requireAuth, userUpdateRouter);
  app.use('/api/locations', requireAuth, locationsRouter);
  app.use('/api/payment-schedules', requireAuth, paymentSchedulesRouter);
  app.use('/api/bn', requireOrgAdmin, bowlnowRouter);
  app.use('/api/integrations', requireOrgAdmin, integrationsRouter);

  log.info('API routes registered');
}
