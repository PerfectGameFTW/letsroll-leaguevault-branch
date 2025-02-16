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

interface PortStatus {
  port: number;
  ready: boolean;
  timestamp: string;
  pid: number;
  mode: string;
  health: {
    database: boolean;
    vite: boolean;
    server: boolean;
  };
}

const app = express();
const server = createServer(app);
let viteSetupComplete = false;
let serverPort: number | null = null;
let isServerReady = false;

// Create a status file to communicate with the workflow
const PORT_STATUS_FILE = '.port-status';

// Add constant for port status cleanup
const STALE_PORT_TIMEOUT = 60000; // 60 seconds

// Basic middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Track active requests for graceful shutdown
let activeRequests = 0;
const requestTracker = (req: Request, res: Response, next: NextFunction) => {
  activeRequests++;
  res.on('finish', () => {
    activeRequests--;
  });
  next();
};

app.use(requestTracker);

// Port status monitoring middleware
app.use(async (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  // Update port status on request start
  if (serverPort) {
    await writePortStatus(serverPort, isServerReady, {
      database: true,
      vite: viteSetupComplete,
      server: true
    });
  }

  // After response monitoring
  res.on('finish', async () => {
    const duration = Date.now() - start;
    if (duration > 1000) { // Only log slow requests
      console.log(`[Server] Slow request: ${req.method} ${req.path} took ${duration}ms`);
    }

    // Update port status after request completion
    if (serverPort) {
      await writePortStatus(serverPort, isServerReady, {
        database: true,
        vite: viteSetupComplete,
        server: true
      });
    }
  });

  next();
});


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

// Enhanced port status writing function
async function writePortStatus(port: number, ready: boolean = false, health: Partial<PortStatus['health']> = {}) {
  try {
    const status: PortStatus = {
      port,
      ready,
      timestamp: new Date().toISOString(),
      pid: process.pid,
      mode: process.env.NODE_ENV || 'development',
      health: {
        database: health.database || false,
        vite: health.vite || false,
        server: health.server || false
      }
    };

    await fs.promises.writeFile(PORT_STATUS_FILE, JSON.stringify(status, null, 2));
    console.log(`[Server] Updated port status:`, status);
  } catch (error) {
    console.error('[Server] Error writing port status:', error);
  }
}

// Enhanced port management functions
const cleanupStalePortStatus = async () => {
  try {
    const status = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8')
      .then(content => JSON.parse(content) as { pid: number; timestamp: string })
      .catch(() => null);

    if (status) {
      const timestampAge = Date.now() - new Date(status.timestamp).getTime();

      // Check if process is still running
      try {
        process.kill(status.pid, 0); // Test if process exists
        if (timestampAge < STALE_PORT_TIMEOUT) {
          throw new Error('Port is in use by another active process');
        }
      } catch (e) {
        // Process doesn't exist or we own it, safe to cleanup
        await fs.promises.unlink(PORT_STATUS_FILE).catch(() => {});
      }
    }
  } catch (error) {
    console.error('[Server] Error cleaning up stale port status:', error);
  }
};

const cleanupPortStatus = async () => {
  try {
    // Attempt to read existing port status
    const existingStatus = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8')
      .then(content => JSON.parse(content) as PortStatus)
      .catch(() => null);

    if (existingStatus) {
      // Check if the process is still running
      try {
        process.kill(existingStatus.pid, 0);
        console.log(`[Server] Found existing server process (PID: ${existingStatus.pid})`);

        // If process exists and port status is recent (within last minute)
        const isRecent = Date.now() - new Date(existingStatus.timestamp).getTime() < 60000;
        if (isRecent) {
          throw new Error('Another server instance is already running');
        }
      } catch (e) {
        // Process doesn't exist, safe to cleanup
        console.log('[Server] Cleaning up stale port status file');
      }
    }

    // Remove the status file
    await fs.promises.unlink(PORT_STATUS_FILE).catch(() => {});
  } catch (error) {
    console.error('[Server] Error during port status cleanup:', error);
    throw error;
  }
};

// Enhanced port availability check
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', (err: NodeJS.ErrnoException) => {
        console.log(`[Server] Port ${port} check failed:`, err.code);
        resolve(false);
      })
      .once('listening', () => {
        tester.once('close', () => {
          console.log(`[Server] Port ${port} is available`);
          resolve(true);
        });
        tester.close();
      })
      .listen(port, '0.0.0.0');

    // Add timeout to prevent hanging
    setTimeout(() => {
      tester.removeAllListeners();
      tester.close();
      console.log(`[Server] Port ${port} check timed out`);
      resolve(false);
    }, 3000);
  });
}

// Enhanced port finding with better error handling
async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
  console.log(`[Server] Looking for available port starting from ${startPort}...`);

  // Clean up any stale port status before starting
  await cleanupStalePortStatus();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = startPort + attempt;

    try {
      const isAvailable = await isPortAvailable(port);
      if (isAvailable) {
        console.log(`[Server] Found available port: ${port}`);
        await writePortStatus(port);
        return port;
      }
      console.log(`[Server] Port ${port} is in use, trying next port...`);
    } catch (error) {
      console.error(`[Server] Error checking port ${port}:`, error);
    }
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

// Update the startServer function to include startup phases
async function startServer() {
  try {
    console.log('[Server] Starting server initialization...');

    // Phase 1: Cleanup
    console.log('[Server] Phase 1: Cleaning up stale port status...');
    await cleanupPortStatus();

    // Phase 2: Database
    console.log('[Server] Phase 2: Testing database connection...');
    await testConnection();
    console.log('[Server] Database connection successful');

    // Phase 3: Port allocation
    console.log('[Server] Phase 3: Allocating port...');
    const preferredPort = parseInt(process.env.PORT || '5000');
    const port = await findAvailablePort(preferredPort);
    serverPort = port;

    // Initial port status - only database is ready
    await writePortStatus(port, false, { database: true });

    // Phase 4: Server startup
    console.log('[Server] Phase 4: Starting HTTP server...');
    const HOST = '0.0.0.0';

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, 30000);

      server.listen(port, HOST, async () => {
        clearTimeout(timeout);
        console.log(`[Server] Server is running at http://${HOST}:${port}`);

        // Update status - server is now ready
        await writePortStatus(port, false, { database: true, server: true });

        if (process.env.NODE_ENV !== "production") {
          console.log('[Server] Running in development mode with Vite middleware');
        } else {
          console.log('[Server] Running in production mode');
        }
        resolve();
      });

      server.once('error', (err) => {
        clearTimeout(timeout);
        console.error('[Server] Failed to start server:', err);
        reject(err);
      });
    });

    // Phase 5: Vite setup (development only)
    if (process.env.NODE_ENV !== "production") {
      console.log('[Server] Phase 5: Setting up Vite...');
      await new Promise<void>((resolve) => {
        const checkVite = setInterval(() => {
          if (viteSetupComplete) {
            clearInterval(checkVite);
            writePortStatus(port, false, { database: true, server: true, vite: true });
            resolve();
          }
        }, 100);
      });
    }

    // Phase 6: Final initialization
    console.log('[Server] Phase 6: Completing initialization...');
    await writePortStatus(port, true, { database: true, server: true, vite: true });
    isServerReady = true;
    console.log(`[Server] Server is fully initialized and ready on port ${port}`);

    // Initialize league schedulers
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
    // Cleanup port status file on error
    if (serverPort) {
      await fs.promises.unlink(PORT_STATUS_FILE).catch(() => {});
    }
    process.exit(1);
  }
}

// Enhance shutdown function with active request tracking
async function shutdown() {
  console.log('[Server] Initiating graceful shutdown...');

  let shutdownTimeout: NodeJS.Timeout;

  try {
    // Set a maximum wait time for active requests
    const forceShutdown = new Promise((_, reject) => {
      shutdownTimeout = setTimeout(() => {
        reject(new Error('Shutdown timeout waiting for active requests'));
      }, 10000); // 10 second timeout
    });

    // Wait for active requests to complete
    const gracefulShutdown = new Promise<void>(async (resolve) => {
      console.log(`[Server] Waiting for ${activeRequests} active requests to complete...`);

      while (activeRequests > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      resolve();
    });

    // Wait for either graceful shutdown or timeout
    await Promise.race([gracefulShutdown, forceShutdown]);
    clearTimeout(shutdownTimeout);

    // Remove port status file
    try {
      await fs.promises.unlink(PORT_STATUS_FILE);
      console.log('[Server] Removed port status file');
    } catch (error) {
      // Ignore error if file doesn't exist
      console.log('[Server] Port status file already removed');
    }

    // Cleanup database connections
    await dbCleanup();
    console.log('[Server] Database connections cleaned up');

    // Close the server with a timeout
    await new Promise<void>((resolve, reject) => {
      const serverTimeout = setTimeout(() => {
        reject(new Error('Server close timeout'));
      }, 5000);

      server.close((err) => {
        clearTimeout(serverTimeout);
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

// Add cleanup handler with timeout
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

// Enhanced health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await testConnection();
    const status = {
      status: 'healthy',
      port: serverPort,
      ready: isServerReady,
      mode: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        url: process.env.DATABASE_URL ? 'configured' : 'missing'
      },
      vite: {
        setup: viteSetupComplete
      }
    };

    // Update port status file with latest health info
    await writePortStatus(serverPort!, isServerReady, {
      database: true,
      vite: viteSetupComplete,
      server: true
    });

    res.json(status);
  } catch (error) {
    console.error('[Server] Health check error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      status: 'unhealthy',
      error: {
        message: errorMessage,
        code: error instanceof Error ? error.name : 'UnknownError',
        timestamp: new Date().toISOString()
      }
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