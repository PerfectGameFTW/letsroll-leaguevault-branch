import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic } from "./vite.js";
import { testConnection } from "./db.js";
import { createServer } from 'http';
import { ScoreSchedulerService } from './services/score-scheduler.js';
import { storage } from './storage.js';

const app = express();

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Enhanced request logging for debugging
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(7);

  console.log(`[${requestId}] ${req.method} ${req.originalUrl}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`[${requestId}] Request body:`, JSON.stringify(req.body, null, 2));
  }

  // Add response logging
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

// Register API routes first
console.log('[Server] Registering API routes...');
const server = registerRoutes(app);

// Set max listeners to avoid warning
server.setMaxListeners(20);

// API catch-all middleware (before Vite)
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

// Frontend handling after API routes
if (app.get("env") === "development") {
  console.log('[Server] Setting up Vite middleware for development...');
  let viteSetupComplete = false;

  app.use(async (req, res, next) => {
    // Skip Vite for API routes
    if (req.path.startsWith('/api/')) {
      return next();
    }

    try {
      if (!viteSetupComplete) {
        await setupVite(app, server);
        viteSetupComplete = true;
      }
      next();
    } catch (e) {
      next(e);
    }
  });
} else {
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

let serverInstance: ReturnType<typeof server.listen> | null = null;

const PORT = 5000;

// Initialize server and score schedulers
async function initializeServer() {
  try {
    console.log('[Server] Starting initialization...');

    // Test database connection
    console.log('[Server] Testing database connection...');
    await testConnection();
    console.log('[Server] Database connection successful');

    // Initialize schedulers for active leagues
    try {
      // Fetch active leagues directly from storage instead of HTTP request
      console.log('[Server] Fetching leagues for scheduler initialization...');
      const leagues = await storage.getLeagues();
      console.log(`[Server] Found ${leagues.length} leagues`);

      for (const league of leagues) {
        if (league.active) {
          console.log(`[Server] Setting up score scheduler for league: ${league.name}`);
          const scheduler = new ScoreSchedulerService(league.id);

          // Schedule score imports based on league's bowling day
          // Format: minute hour * * dayOfWeek
          // Example: '0 22 * * 1' for Monday at 10 PM
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
      // Continue server initialization even if scheduler setup fails
    }

    // Start server
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        console.log(`[Server] Ready and listening on port ${PORT}`);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      serverInstance = server.listen(PORT, '0.0.0.0');
    });

    console.log('[Server] Application fully initialized and ready for requests');
  } catch (error) {
    console.error('[Server] Fatal error during initialization:', error);
    process.exit(1);
  }
}

// Cleanup on exit
process.on('SIGTERM', () => {
  console.log('[Server] Received SIGTERM signal, shutting down...');
  if (serverInstance) {
    serverInstance.close(() => {
      console.log('[Server] Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// Start the server
initializeServer().catch((error) => {
  console.error('[Server] Unhandled error during startup:', error);
  process.exit(1);
});