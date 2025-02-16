import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic } from "./vite.js";
import { testConnection } from "./db.js";
import { createServer } from 'http';
import { ScoreSchedulerService } from './services/score-scheduler.js';
import { storage } from './storage.js';

const app = express();
const server = createServer(app);
let viteSetupComplete = false;

// Set max listeners to avoid warning
server.setMaxListeners(20);

// WebSocket connection logging with path filtering
server.on('upgrade', (req, socket, head) => {
  // Ignore Vite HMR WebSocket connections (they typically use /@vite/client)
  if (req.url?.includes('/@vite') || req.url?.includes('vite-hmr')) {
    console.log(`[WebSocket] Skipping Vite HMR upgrade request for: ${req.url}`);
    return;
  }
  console.log(`[WebSocket] Processing application upgrade request for path: ${req.url}`);
});

// Setup Vite first in development mode
if (app.get("env") === "development" && !viteSetupComplete) {
  console.log('[Server] Setting up Vite middleware for development...');
  setupVite(app, server)
    .then(() => {
      console.log('[Server] Vite middleware setup complete');
      viteSetupComplete = true;
      setupRestOfServer();
    })
    .catch((error) => {
      console.error('[Server] Error setting up Vite:', error);
      process.exit(1);
    });
} else {
  setupRestOfServer();
}

function setupRestOfServer() {
  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Enhanced request logging
  app.use((req, res, next) => {
    // Skip logging for Vite HMR requests
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

  // API-specific middleware
  app.use('/api', (req, res, next) => {
    console.log('[API] Handling request:', req.method, req.path);
    res.setHeader('Content-Type', 'application/json');
    next();
  });

  // Register API routes
  console.log('[Server] Registering API routes...');
  registerRoutes(app);

  // API catch-all middleware
  app.use('/api/*', (req, res) => {
    console.log('[API] Unhandled API route:', req.method, req.path);
    res.status(404).json({
      success: false,
      error: {
        message: 'API endpoint not found',
        path: req.path
      }
    });
  });

  // Setup static file serving in production
  if (app.get("env") !== "development") {
    console.log('[Server] Setting up static file serving for production...');
    serveStatic(app);
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

  const HOST = '0.0.0.0';
  const PORT = process.env.PORT || 5000;

  // Function to handle graceful shutdown
  function shutdown() {
    console.log('[Server] Initiating graceful shutdown...');
    server.close(() => {
      console.log('[Server] Server closed');
      process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
      console.error('[Server] Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  }

  // Initialize server and score schedulers
  async function initializeServer() {
    try {
      console.log('[Server] Starting initialization...');

      // Test database connection
      console.log('[Server] Testing database connection...');
      await testConnection();
      console.log('[Server] Database connection successful');

      // Start server
      await new Promise<void>((resolve, reject) => {
        console.log(`[Server] Attempting to start server on ${HOST}:${PORT}...`);

        const onError = (err: any) => {
          if (err.code === 'EADDRINUSE') {
            console.error(`[Server] Port ${PORT} is already in use. Please ensure no other instance is running.`);
          } else {
            console.error('[Server] Failed to start server:', err);
          }
          server.removeListener('listening', onListening);
          reject(err);
        };

        const onListening = () => {
          console.log(`[Server] Server is running at http://${HOST}:${PORT}`);
          server.removeListener('error', onError);
          resolve();
        };

        server.once('error', onError);
        server.once('listening', onListening);

        try {
          server.listen(Number(PORT), HOST);
        } catch (error) {
          console.error('[Server] Error creating server instance:', error);
          reject(error);
        }
      });

      // Initialize schedulers for active leagues
      try {
        console.log('[Server] Fetching leagues for scheduler initialization...');
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
            const cronExpression = `0 22 * * ${dayNumber}`; // Schedule for 10 PM on league day

            scheduler.scheduleJob(
              cronExpression,
              process.env.GOOGLE_DRIVE_SOURCE_FOLDER_ID!,
              process.env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID!
            );

            console.log(`[Server] Scheduled score import for league ${league.name}: ${cronExpression}`);
          }
        }
      } catch (error) {
        console.error('[Server] Error setting up score schedulers:', error);
      }

      console.log('[Server] Application fully initialized and ready for requests');
    } catch (error) {
      console.error('[Server] Fatal error during initialization:', error);
      process.exit(1);
    }
  }

  // Start the server
  initializeServer().catch((error) => {
    console.error('[Server] Unhandled error during startup:', error);
    process.exit(1);
  });

  // Setup signal handlers for graceful shutdown
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}