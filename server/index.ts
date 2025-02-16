import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { setupVite } from "./vite.js";
import { testConnection, cleanup as dbCleanup } from "./db.js";
import { createServer } from 'http';
import { ScoreSchedulerService } from './services/score-scheduler.js';
import { storage } from './storage.js';
import path from 'path';

const app = express();
const server = createServer(app);
let viteSetupComplete = false;

// Basic middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Enhanced request logging
app.use((req, res, next) => {
  if (req.path.includes('/@vite') || req.path.includes('vite-hmr')) {
    return next();
  }

  const start = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[${requestId}] ${req.method} ${req.originalUrl}`);

  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`[${requestId}] Request body:`, JSON.stringify(req.body, null, 2));
  }

  const oldJson = res.json;
  res.json = function(body) {
    console.log(`[${requestId}] Response body:`, JSON.stringify(body));
    return oldJson.call(this, body);
  };

  res.on('finish', () => {
    console.log(`[${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Add health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await testConnection();
    sendSuccess(res, { status: 'healthy', database: 'connected' });
  } catch (error) {
    sendError(res, 'Database connection failed', 500);
  }
});

// API-specific middleware
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Register API routes
console.log('[Server] Registering API routes...');
registerRoutes(app);

// Development mode setup
if (process.env.NODE_ENV !== "production") {
  console.log('[Server] Setting up Vite middleware for development...');
  setupVite(app, server)
    .then(() => {
      console.log('[Server] Vite middleware setup complete');
      viteSetupComplete = true;
      startServer();
    })
    .catch((error) => {
      console.error('[Server] Error setting up Vite:', error);
      process.exit(1);
    });
} else {
  // Production mode setup
  app.use(express.static(path.join(process.cwd(), 'dist/public')));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(process.cwd(), 'dist/public/index.html'));
  });
  startServer();
}

async function startServer() {
  try {
    console.log('[Server] Testing database connection...');
    await testConnection();
    console.log('[Server] Database connection successful');

    // Try different ports if the default is in use
    const tryPort = async (startPort: number, maxAttempts: number = 5): Promise<number> => {
      for (let port = startPort; port < startPort + maxAttempts; port++) {
        try {
          await new Promise((resolve, reject) => {
            const tempServer = createServer();
            tempServer.listen(port)
              .once('listening', () => {
                tempServer.close(() => resolve(port));
              })
              .once('error', (err: any) => {
                if (err.code === 'EADDRINUSE') {
                  console.log(`[Server] Port ${port} is in use, trying next port...`);
                  resolve(0);
                } else {
                  reject(err);
                }
              });
          });
          return port;
        } catch (err) {
          console.error(`[Server] Error trying port ${port}:`, err);
        }
      }
      throw new Error('No available ports found');
    };

    const preferredPort = parseInt(process.env.PORT || '5000');
    const port = await tryPort(preferredPort);
    const HOST = '0.0.0.0';

    server.listen(port, HOST, () => {
      console.log(`[Server] Server is running at http://${HOST}:${port}`);
      if (process.env.NODE_ENV !== "production") {
        console.log('[Server] Running in development mode with Vite middleware');
      } else {
        console.log('[Server] Running in production mode');
      }
    });

    // Initialize league schedulers after server starts
    try {
      const leagues = await storage.getLeagues();
      console.log(`[Server] Found ${leagues.length} leagues`);

      for (const league of leagues) {
        if (league.active) {
          console.log(`[Server] Setting up score scheduler for league: ${league.name}`);
          const scheduler = new ScoreSchedulerService(league.id);
          const dayMap: { [key: string]: number } = {
            'monday': 1, 'tuesday': 2, 'wednesday': 3,
            'thursday': 4, 'friday': 5, 'saturday': 6, 'sunday': 0
          };

          const dayNumber = dayMap[league.weekDay.toLowerCase()];
          const cronExpression = `0 22 * * ${dayNumber}`;
          scheduler.scheduleJob(
            cronExpression,
            process.env.GOOGLE_DRIVE_SOURCE_FOLDER_ID!,
            process.env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID!
          );
        }
      }
    } catch (error) {
      console.error('[Server] Error setting up score schedulers:', error);
    }
  } catch (error) {
    console.error('[Server] Fatal error during startup:', error);
    process.exit(1);
  }
}

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Error]', err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      success: false,
      error: {
        message: err.message || "Internal Server Error",
        code: err.code,
        timestamp: new Date().toISOString()
      }
    });
  }
  next(err);
});

// Handle graceful shutdown
async function shutdown() {
  console.log('[Server] Initiating graceful shutdown...');

  try {
    // Cleanup database connections first
    await dbCleanup();
    console.log('[Server] Database connections cleaned up');

    // Close the server
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });

    console.log('[Server] Server closed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[Server] Error during shutdown:', error);
    process.exit(1);
  }
}

// Use longer timeout for graceful shutdown
const SHUTDOWN_TIMEOUT = 30000; // 30 seconds

process.on('SIGTERM', () => {
  console.log('[Server] Received SIGTERM signal');
  const forceShutdown = setTimeout(() => {
    console.error('[Server] Forced shutdown due to timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  shutdown().finally(() => clearTimeout(forceShutdown));
});

process.on('SIGINT', () => {
  console.log('[Server] Received SIGINT signal');
  const forceShutdown = setTimeout(() => {
    console.error('[Server] Forced shutdown due to timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  shutdown().finally(() => clearTimeout(forceShutdown));
});

// Helper functions
function sendSuccess(res: Response, data: any) {
  res.status(200).json({ success: true, data });
}

function sendError(res: Response, message: string, statusCode: number = 500) {
  res.status(statusCode).json({ success: false, error: message });
}