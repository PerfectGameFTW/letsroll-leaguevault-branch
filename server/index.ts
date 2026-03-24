import { env, isDev } from "./config";
import * as Sentry from "@sentry/node";
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import { registerRoutes } from "./routes/index";
import { setupVite } from "./vite";
import { testConnection, cleanup as dbCleanup } from "./db";
import { createServer } from 'http';
import { storage } from './storage';
import path from 'path';
import { setupAuth } from "./auth";
import { paymentScheduler } from './services/payment-scheduler';
import { ensureAvatarsDirectory, migrateAvatarsFromDBToDisk, migrateApiUrlsToDiskUrls } from './migrations/migrate-avatars';
import { createLogger } from './logger';
import { csrfProtection, csrfTokenEndpoint } from './middleware/csrf';
import { subdomainDetection, orgSessionGuard } from './middleware/subdomain';
import manifestRouter from './routes/manifest';

const log = createLogger("Server");

const app = express();
app.set("trust proxy", 1);
const server = createServer(app);

const HOST = '0.0.0.0';
const PORT = env.PORT;

function getAllowedOrigins(): string[] {
  const origins: string[] = [];
  origins.push('https://leaguevault.app');
  if (isDev) {
    if (env.REPLIT_DOMAINS) {
      for (const domain of env.REPLIT_DOMAINS.split(',')) {
        origins.push(`https://${domain}`);
      }
    }
    if (env.REPL_SLUG && env.REPL_OWNER) {
      origins.push(`https://${env.REPL_SLUG}.${env.REPL_OWNER}.repl.co`);
    }
    origins.push('http://localhost:5000');
    origins.push('http://localhost:5173');
    origins.push('http://127.0.0.1:5000');
    origins.push('http://127.0.0.1:5173');
  }
  return origins;
}

const allowedOrigins = getAllowedOrigins();

function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.includes(origin)) return true;
  if (origin === 'capacitor://localhost' || origin === 'ionic://localhost') return true;
  if (origin === 'http://localhost') return true;
  try {
    const url = new URL(origin);
    if (url.hostname.endsWith('.leaguevault.app') && url.protocol === 'https:') {
      return true;
    }
  } catch {}
  return false;
}

let activeRequests = 0;
let viteSetupComplete = false;

const requestTracker = (req: Request, res: Response, next: NextFunction) => {
  activeRequests++;
  res.on('finish', () => { activeRequests--; });
  next();
};

app.use(requestTracker);

app.use(subdomainDetection);
app.use(compression());

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://web.squarecdn.com",
        "https://sandbox.web.squarecdn.com",
        "https://pay.google.com",
        ...(isDev ? ["'unsafe-inline'", "'unsafe-eval'"] : []),
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://web.squarecdn.com",
        "https://sandbox.web.squarecdn.com",
      ],
      connectSrc: [
        "'self'",
        "https://web.squarecdn.com",
        "https://sandbox.web.squarecdn.com",
        "https://pds.squareup.com",
        "https://connect.squareup.com",
        "https://connect.squareupsandbox.com",
        "https://pci-connect.squareup.com",
        "https://pci-connect.squareupsandbox.com",
        "https://square-fonts-production-f.squarecdn.com",
        "https://d1g145x70srn7h.cloudfront.net",
        "https://pay.google.com",
        "https://google.com",
        "https://apple.com",
        "https://*.apple.com",
        "https://*.apple-pay-gateway.apple.com",
        "https://*.ingest.sentry.io",
        "https://*.ingest.us.sentry.io",
        ...(isDev ? ["ws:", "wss:"] : []),
      ],
      frameSrc: [
        "'self'",
        "https://web.squarecdn.com",
        "https://sandbox.web.squarecdn.com",
        "https://pci-connect.squareup.com",
        "https://pci-connect.squareupsandbox.com",
        "https://pay.google.com",
        "https://apple.com",
        "https://*.apple.com",
      ],
      imgSrc: ["'self'", "data:", "blob:", "https://web.squarecdn.com", "https://sandbox.web.squarecdn.com"],
      fontSrc: ["'self'", "data:", "https://square-fonts-production-f.squarecdn.com", "https://d1g145x70srn7h.cloudfront.net"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: isDev
        ? ["*"]
        : ["'self'", "https://leaguevault.app", "https://*.leaguevault.app"],
    },
  },
  frameguard: isDev ? false : { action: 'sameorigin' },
  strictTransportSecurity: {
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true,
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
setupAuth(app);
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

app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Vary', 'Origin');
    if (isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-csrf-token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

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
      viteSetupComplete = true;
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

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
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
      log.warn('Database connection failed, starting without database');
    } else {
      log.info('Database connected');
    }

    ensureAvatarsDirectory();

    if (dbConnected) {
      try {
        const dbMigrationOk = await migrateAvatarsFromDBToDisk();
        if (dbMigrationOk) {
          await migrateApiUrlsToDiskUrls();
        }
      } catch (error) {
        log.error('Error running avatar migration:', error);
      }
    }

    server.listen({ port: PORT, host: HOST }, () => {
      log.info(`Running at http://${HOST}:${PORT}`);
    });

    if (dbConnected) {
      try {
        await paymentScheduler.initialize();
        log.info('Schedulers initialized');
      } catch (error) {
        log.error('Error initializing schedulers:', error);
      }
    }
  } catch (error) {
    log.error('Critical startup error:', error);
    process.exit(1);
  }
}

const DRAIN_POLL_INTERVAL_MS = 100;

async function shutdown() {
  log.info('Shutting down...');
  const startTime = Date.now();

  try {
    paymentScheduler?.cancelAllJobs();

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        log.warn(`Forcing shutdown with ${activeRequests} active requests`);
        resolve();
      }, 10000);

      const waitForDrain = () => {
        if (activeRequests <= 0) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(waitForDrain, DRAIN_POLL_INTERVAL_MS);
        }
      };
      waitForDrain();
    });

    await dbCleanup();

    await new Promise<void>((resolve, reject) => {
      const SERVER_CLOSE_TIMEOUT_MS = 5000;
      const timeout = setTimeout(() => reject(new Error('Server close timeout')), SERVER_CLOSE_TIMEOUT_MS);
      server.close((err) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      });
    });

    log.info(`Shutdown completed in ${Date.now() - startTime}ms`);
    process.exit(0);
  } catch (error) {
    log.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled rejection:', reason);
  shutdown();
});
