import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { setupVite } from "./vite.js";
import { testConnection, cleanup as dbCleanup } from "./db.js";
import { createServer } from 'http';
import { ScoreSchedulerService } from './services/score-scheduler.js';
import { storage } from './storage.js';
import path from 'path';
import net from 'net';
import fs from 'fs';

const app = express();
const server = createServer(app);
let viteSetupComplete = false;
let serverPort: number | null = null;
let isServerReady = false;

// Create a status file to communicate with the workflow
const PORT_STATUS_FILE = '.port-status';

// Basic middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Enhanced request logging with port information
app.use((req, res, next) => {
  if (req.path.includes('/@vite') || req.path.includes('vite-hmr')) {
    return next();
  }

  const start = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[${requestId}] ${req.method} ${req.originalUrl} on port ${serverPort}`);

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

// Function to write port status
async function writePortStatus(port: number, ready: boolean = false) {
  try {
    await fs.promises.writeFile(PORT_STATUS_FILE, JSON.stringify({
      port,
      ready,
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.error('[Server] Error writing port status:', error);
  }
}

// Function to check if a port is available
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => {
        resolve(false);
      })
      .once('listening', () => {
        tester.once('close', () => resolve(true));
        tester.close();
      })
      .listen(port, '0.0.0.0');
  });
}

// Find an available port with retries
async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
  console.log(`[Server] Looking for available port starting from ${startPort}...`);

  for (let port = startPort; port < startPort + maxAttempts; port++) {
    const isAvailable = await isPortAvailable(port);
    if (isAvailable) {
      console.log(`[Server] Found available port: ${port}`);
      await writePortStatus(port); // Write initial port status
      return port;
    }
    console.log(`[Server] Port ${port} is in use, trying next port...`);
  }

  throw new Error(`No available ports found between ${startPort} and ${startPort + maxAttempts - 1}`);
}

// Function to wait for the server to be ready
function waitForServerReady(port: number): Promise<void> {
  return new Promise((resolve) => {
    const checkInterval = setInterval(async () => {
      try {
        const response = await fetch(`http://localhost:${port}/api/health`);
        if (response.ok) {
          clearInterval(checkInterval);
          isServerReady = true;
          await writePortStatus(port, true); // Update status when server is ready
          console.log(`[Server] Server is ready on port ${port}`);
          resolve();
        }
      } catch (error) {
        // Ignore fetch errors while waiting
      }
    }, 100);

    // Timeout after 30 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      console.log(`[Server] Server readiness check timed out on port ${port}`);
      resolve();
    }, 30000);
  });
}

// Update the health check endpoint to be more detailed
app.get('/api/health', async (req, res) => {
  try {
    await testConnection();
    res.json({
      status: 'healthy',
      port: serverPort,
      ready: isServerReady,
      mode: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'unhealthy',
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
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
    // Remove any existing port status file
    try {
      await fs.promises.unlink(PORT_STATUS_FILE);
    } catch (error) {
      // Ignore error if file doesn't exist
    }

    console.log('[Server] Testing database connection...');
    await testConnection();
    console.log('[Server] Database connection successful');

    const preferredPort = parseInt(process.env.PORT || '5000');
    const port = await findAvailablePort(preferredPort);
    serverPort = port;
    const HOST = '0.0.0.0';

    await new Promise<void>((resolve, reject) => {
      server.listen(port, HOST, () => {
        console.log(`[Server] Server is running at http://${HOST}:${port}`);
        if (process.env.NODE_ENV !== "production") {
          console.log('[Server] Running in development mode with Vite middleware');
        } else {
          console.log('[Server] Running in production mode');
        }
        resolve();
      });

      server.once('error', (err) => {
        console.error('[Server] Failed to start server:', err);
        reject(err);
      });
    });

    // Wait for the server to be fully ready
    await waitForServerReady(port);
    console.log(`[Server] Server is fully initialized and ready on port ${port}`);

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
    // Remove port status file
    try {
      await fs.promises.unlink(PORT_STATUS_FILE);
    } catch (error) {
      // Ignore error if file doesn't exist
    }

    // Cleanup database connections first
    await dbCleanup();
    console.log('[Server] Database connections cleaned up');

    // Close the server
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
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