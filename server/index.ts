import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes/index";
import { setupVite } from "./vite";
import { testConnection, cleanup as dbCleanup } from "./db";
import { createServer } from 'http';
import { storage } from './storage';
import path from 'path';
import fs from 'fs';
import { setupAuth } from "./auth";
import { paymentScheduler } from './services/payment-scheduler';

const app = express();
app.set("trust proxy", 1);
const server = createServer(app);

const HOST = '0.0.0.0';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

const isDev = process.env.NODE_ENV !== "production";

function getAllowedOrigins(): string[] {
  const origins: string[] = [];
  origins.push('https://leaguevault.app');
  if (isDev) {
    if (process.env.REPLIT_DOMAINS) {
      for (const domain of process.env.REPLIT_DOMAINS.split(',')) {
        origins.push(`https://${domain}`);
      }
    }
    if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
      origins.push(`https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
    }
    origins.push('http://localhost:5000');
    origins.push('http://localhost:5173');
    origins.push('http://127.0.0.1:5000');
    origins.push('http://127.0.0.1:5173');
  }
  return origins;
}

const allowedOrigins = getAllowedOrigins();

let activeRequests = 0;
let viteSetupComplete = false;

const requestTracker = (req: Request, res: Response, next: NextFunction) => {
  activeRequests++;
  res.on('finish', () => { activeRequests--; });
  next();
};

app.use(requestTracker);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://web.squarecdn.com",
        "https://sandbox.web.squarecdn.com",
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
        "https://o160250.ingest.sentry.io",
        ...(isDev ? ["ws:", "wss:"] : []),
      ],
      frameSrc: [
        "'self'",
        "https://web.squarecdn.com",
        "https://sandbox.web.squarecdn.com",
        "https://pci-connect.squareup.com",
        "https://pci-connect.squareupsandbox.com",
      ],
      imgSrc: ["'self'", "data:", "blob:", "https://web.squarecdn.com", "https://sandbox.web.squarecdn.com"],
      fontSrc: ["'self'", "data:", "https://square-fonts-production-f.squarecdn.com", "https://d1g145x70srn7h.cloudfront.net"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: isDev
        ? [
            "'self'",
            "https://*.replit.com",
            "https://*.replit.dev",
            "https://*.repl.co",
            ...[process.env.REPLIT_DEV_DOMAIN, ...(process.env.REPLIT_DOMAINS || '').split(',')]
              .filter(Boolean)
              .map(domain => {
                const parts = domain!.trim().split('.');
                return parts.length > 2 ? `https://*.${parts.slice(1).join('.')}` : null;
              })
              .filter((v, i, a): v is string => v !== null && a.indexOf(v) === i),
          ]
        : ["'self'", "https://leaguevault.app"],
    },
  },
  frameguard: isDev ? false : { action: 'sameorigin' },
  strictTransportSecurity: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
setupAuth(app);

app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Vary', 'Origin');
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

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
      }
    });
  } catch (error) {
    console.error('[Server] Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Service unavailable'
    });
  }
});

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

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

if (process.env.NODE_ENV !== "production") {
  setupVite(app, server)
    .then(() => {
      console.log('[Server] Vite middleware ready');
      viteSetupComplete = true;
      startServer();
    })
    .catch((error) => {
      console.error('[Server] Critical error setting up Vite:', error);
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

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Error]', err);
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
        message: clientMessage,
        timestamp: new Date().toISOString()
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
      console.error(`[Server] Database connection attempt ${attempt}/${maxRetries} failed:`, error);
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
      console.warn('[Server] Database connection failed, starting without database');
    } else {
      console.log('[Server] Database connected');
    }

    server.listen({ port: PORT, host: HOST }, () => {
      console.log(`[Server] Running at http://${HOST}:${PORT}`);
    });

    if (dbConnected) {
      try {
        await paymentScheduler.initialize();
        console.log('[Server] Schedulers initialized');
      } catch (error) {
        console.error('[Server] Error initializing schedulers:', error);
      }
    }
  } catch (error) {
    console.error('[Server] Critical startup error:', error);
    process.exit(1);
  }
}

async function shutdown() {
  console.log('[Server] Shutting down...');
  const startTime = Date.now();

  try {
    paymentScheduler?.cancelAllJobs();

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn(`[Server] Forcing shutdown with ${activeRequests} active requests`);
        resolve();
      }, 10000);

      const waitForDrain = () => {
        if (activeRequests <= 0) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(waitForDrain, 100);
        }
      };
      waitForDrain();
    });

    await dbCleanup();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server close timeout')), 5000);
      server.close((err) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`[Server] Shutdown completed in ${Date.now() - startTime}ms`);
    process.exit(0);
  } catch (error) {
    console.error('[Server] Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);

process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled rejection:', reason);
  shutdown();
});
