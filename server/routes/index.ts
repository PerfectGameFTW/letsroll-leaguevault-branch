import type { Express } from "express";
import { Router } from "express";
import leaguesRouter from './leagues.js';
import teamsRouter from './teams.js';
import bowlersRouter from './bowlers.js';
import paymentsRouter from './payments/index.js';
import bowlerLeaguesRouter from './bowler-leagues.js';
import scoresRouter from './scores.js';
import gamesRouter from './games.js';
import paymentRoutesRouter from './payments-provider/index.js';
import adminRouter from './admin.js';
import organizationsRouter from './organizations.js';
import organizationsPublicRouter from './organizations-public.js';
import orgAdminRouter from './organization-admin.js';
import userBowlersRouter from './user-bowlers.js';
import setupAdminRouter from './setup-admin.js';
import systemAdminRouter from './system-admin.js';
import userAvatarRouter from './user-avatar.js';
import locationsRouter from './locations.js';
import paymentSchedulesRouter from './payment-schedules.js';
import bowlnowRouter from './bowlnow.js';
import integrationsRouter from './integrations.js';
import accountRouter from './account.js';
import { registerAuthRoutes } from './auth.js';
import bulkImportRouter from './bulk-import.js';
import searchRouter from './search.js';
import { requireAuth, requireOrgAdmin, requireSystemAdmin, requirePasswordRotated } from '../middleware/auth.js';
import { createLogger } from '../logger';

const log = createLogger("Routes");

export function registerRoutes(app: Express): void {
  log.info('Registering API routes...');

  // Auth endpoints (/api/auth/*) are mounted first so they take precedence
  // over the broader /api/* middleware below.
  registerAuthRoutes(app);

  app.get('/api/user', (req, res) => {
    req.url = '/api/auth/user';
    app._router.handle(req, res);
  });

  app.post('/api/logout', (req, res) => {
    req.url = '/api/auth/logout';
    app._router.handle(req, res);
  });

  app.use('/api/organizations', organizationsPublicRouter);

  // Task #455: server-side enforcement of the must-change-password
  // gate. Mounted here so the auth routes registered above (and the
  // /api/user / /api/logout aliases) remain reachable for a flagged
  // user — they need to sign out, refetch their flag, and POST
  // /api/account/change-password — but every other protected
  // /api/* endpoint returns 403 PASSWORD_CHANGE_REQUIRED until the
  // flag is cleared. See the middleware doc for the full allowlist
  // and the security rationale.
  app.use('/api', requirePasswordRotated);

  app.use('/api/leagues', requireAuth, leaguesRouter);
  app.use('/api/teams', requireAuth, teamsRouter);
  app.use('/api/bowlers/bulk-import', requireOrgAdmin, bulkImportRouter);
  app.use('/api/bowlers', requireAuth, bowlersRouter);
  app.use('/api/bowler-leagues', requireAuth, bowlerLeaguesRouter);
  app.use('/api/payments', requireAuth, paymentsRouter);
  app.use('/api/scores', requireAuth, scoresRouter);
  app.use('/api/games', requireAuth, gamesRouter);
  app.use('/api/payments-provider', requireAuth, paymentRoutesRouter);
  app.use('/api/admin', requireOrgAdmin, adminRouter);
  app.use('/api/organizations', requireAuth, organizationsRouter);
  app.use('/api/org-admin', requireOrgAdmin, orgAdminRouter);
  app.use('/api/user-bowlers', requireAuth, userBowlersRouter);
  app.use('/api/setup', setupAdminRouter); // setup routes have their own secret-based auth
  app.use('/api/system-admin', requireSystemAdmin, systemAdminRouter);
  app.use('/api/user', requireAuth, userAvatarRouter);
  app.use('/api/locations', requireAuth, locationsRouter);
  app.use('/api/payment-schedules', requireAuth, paymentSchedulesRouter);
  app.use('/api/bn', requireOrgAdmin, bowlnowRouter);
  app.use('/api/integrations', requireOrgAdmin, integrationsRouter);
  app.use('/api/account', accountRouter);
  app.use('/api/search', requireAuth, searchRouter);

  log.info('API routes registered');
}
