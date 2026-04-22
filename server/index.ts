import { env, isDev } from "./config";
import * as Sentry from "@sentry/node";
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes/index";
import { setupVite } from "./vite";
import { testConnection } from "./db";
import { createServer } from 'http';
import path from 'path';
import { setupAuth } from "./auth";
import { paymentScheduler } from './services/payment-scheduler';
import { startPaymentSyncRetrySweep } from './services/payment-sync-retry';
import { applePayWorker } from './services/apple-pay-worker';
import { ensureAvatarsDirectory, migrateAvatarsFromDBToDisk, migrateApiUrlsToDiskUrls } from './migrations/migrate-avatars';
import { createLogger } from './logger';
import { csrfProtection, csrfTokenEndpoint } from './middleware/csrf';
import { subdomainDetection, orgSessionGuard } from './middleware/subdomain';
import { securityHeaders, apiHeaders } from './middleware/security';
import { requestTracker, registerShutdownHandlers } from './lib/shutdown';
import manifestRouter from './routes/manifest';

const log = createLogger("Server");

const app = express();
app.set("trust proxy", 1);
const server = createServer(app);

const HOST = '0.0.0.0';
const PORT = env.PORT;

app.use(requestTracker);
app.use(subdomainDetection);
app.use(compression());
app.use(securityHeaders);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
await setupAuth(app);
app.use(orgSessionGuard);

app.use(manifestRouter);

app.use('/uploads/avatars', express.static(path.join(process.cwd(), 'uploads', 'avatars'), {
  maxAge: '1h',
  immutable: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

app.get('/loaderio-19ef38424d52907d2a5ef69f13f4794b.txt', (_req, res) => {
  res.type('text/plain').send('loaderio-19ef38424d52907d2a5ef69f13f4794b');
});

app.get('/.well-known/apple-app-site-association', (_req, res) => {
  res.set('Content-Type', 'application/json');
  res.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: 'TEAM_ID.app.leaguevault.mobile',
          paths: ['*'],
        },
      ],
    },
  });
});

app.get('/.well-known/assetlinks.json', (_req, res) => {
  res.set('Content-Type', 'application/json');
  res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'app.leaguevault.mobile',
        sha256_cert_fingerprints: [],
      },
    },
  ]);
});

app.get('/.well-known/apple-developer-merchantid-domain-association', async (_req, res) => {
  const staticPath = path.join(import.meta.dirname, '..', '.well-known', 'apple-developer-merchantid-domain-association');
  try {
    const { access } = await import('fs/promises');
    await access(staticPath);
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', 'attachment; filename="apple-developer-merchantid-domain-association"');
    return res.sendFile(path.resolve(staticPath));
  } catch {
    // Fall back to env var if static file not present
  }
  const verification = process.env.APPLE_PAY_DOMAIN_VERIFICATION;
  if (verification) {
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', 'attachment; filename="apple-developer-merchantid-domain-association"');
    res.send(verification);
    return;
  }
  res.status(404).type('text/plain').send('Not configured');
});

app.use('/api', apiHeaders);

app.get('/api/csrf-token', csrfTokenEndpoint);
app.use('/api', csrfProtection);

app.get('/api/health', async (req, res) => {
  try {
    const dbStart = Date.now();
    await testConnection();
    const dbDuration = Date.now() - dbStart;

    res.json({
      status: 'healthy',
      port: PORT,
      timestamp: new Date().toISOString(),
      diagnostics: {
        database_response_time: `${dbDuration}ms`,
        uptime: process.uptime(),
        hostname: req.hostname,
      }
    });
  } catch (error) {
    log.error('Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Service unavailable'
    });
  }
});

registerRoutes(app);

app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'API endpoint not found',
      path: req.path,
      method: req.method
    }
  });
});

if (isDev) {
  setupVite(app, server)
    .then(() => {
      log.info('Vite middleware ready');
      startServer();
    })
    .catch((error) => {
      log.error('Critical error setting up Vite:', error);
      process.exit(1);
    });
} else {
  app.use(express.static(path.join(process.cwd(), 'dist/public'), {
    maxAge: '1y',
    immutable: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    }
  }));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(process.cwd(), 'dist/public/index.html'));
  });
  startServer();
}

Sentry.setupExpressErrorHandler(app);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  log.error('Unhandled express error:', err);
  if (!res.headersSent) {
    const statusCode = (typeof err.status === 'number' && err.status >= 400 && err.status < 500)
      ? err.status
      : 500;
    const clientMessage = statusCode < 500
      ? (err.message || "Bad request")
      : "An internal error occurred";
    res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
        message: clientMessage,
      }
    });
  }
});

async function testDatabaseConnectionWithRetry(maxRetries = 3, backoffMs = 1000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await testConnection();
      return true;
    } catch (error) {
      log.error(`Database connection attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt === maxRetries) return false;
      const delay = backoffMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return false;
}

async function startServer() {
  try {
    const dbConnected = await testDatabaseConnectionWithRetry();
    if (!dbConnected) {
      log.error('Database connection failed after all retry attempts, refusing to start');
      process.exit(1);
    }
    log.info('Database connected');

    ensureAvatarsDirectory();

    try {
      const dbMigrationOk = await migrateAvatarsFromDBToDisk();
      if (dbMigrationOk) {
        await migrateApiUrlsToDiskUrls();
      }
    } catch (error) {
      log.error('Error running avatar migration:', error);
    }

    server.listen({ port: PORT, host: HOST }, () => {
      log.info(`Running at http://${HOST}:${PORT}`);
    });

    try {
      await paymentScheduler.initialize();
      paymentScheduler.startSweepPoll();
      log.info('Schedulers initialized with 60-second sweep poll');

      // Background retry sweep for failed payment-customer syncs
      // (task #284). Walks bowlers flagged with payment_sync_pending_at
      // and re-runs syncBowlerForUser with exponential backoff.
      startPaymentSyncRetrySweep();

      // Resume any in-flight or pending Apple Pay bulk-registration jobs that
      // were interrupted by a previous server restart.
      applePayWorker.resumeOnStartup().catch((err) => {
        log.error('Apple Pay worker resume failed:', err);
      });
    } catch (error) {
      log.error('Error initializing schedulers:', error);
    }
  } catch (error) {
    log.error('Critical startup error:', error);
    process.exit(1);
  }
}

registerShutdownHandlers(server);
