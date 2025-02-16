import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { setupVite } from "./vite.js";
import { testConnection } from "./db.js";
import { createServer } from 'http';
import { ScoreSchedulerService } from './services/score-scheduler.js';
import { storage } from './storage.js';

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

// Health check endpoint - add this before API routes
app.get('/health', async (_req, res) => {
  try {
    await testConnection();
    res.json({ status: 'healthy', message: 'Server is ready' });
  } catch (error) {
    console.error('[Health Check] Database connection failed:', error);
    res.status(500).json({ status: 'unhealthy', message: 'Database connection failed' });
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

// Setup Vite in development mode
if (process.env.NODE_ENV === "development" && !viteSetupComplete) {
  console.log('[Server] Setting up Vite middleware for development...');
  setupVite(app)
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
  startServer();
}

async function startServer() {
  try {
    // Test database connection
    console.log('[Server] Testing database connection...');
    await testConnection();
    console.log('[Server] Database connection successful');

    const PORT = process.env.PORT || 5000;

    // Check if port is in use and start server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] Server is running at http://0.0.0.0:${PORT}`);
    }).on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${PORT} is already in use. Please ensure no other instance is running.`);
        process.exit(1);
      } else {
        console.error('[Server] Server startup error:', error);
        process.exit(1);
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
function shutdown() {
  console.log('[Server] Initiating graceful shutdown...');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[Server] Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);