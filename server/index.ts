const STARTUP_PHASE_TIMEOUT = 60000; // 60 seconds
const SHUTDOWN_TIMEOUT = 60000; // 60 seconds
const HOST = '0.0.0.0';
const preferredPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

// Define phase tracking interfaces
interface StartupPhases {
  cleanup: boolean;
  database: boolean;
  port: boolean;
  server: boolean;
  vite: boolean;
  final: boolean;
}

interface ShutdownPhases {
  initiated: boolean;
  requests_drained: boolean;
  port_status_cleaned: boolean;
  database_cleaned: boolean;
  server_closed: boolean;
}

// Initialize phase tracking
const startupPhases: StartupPhases = {
  cleanup: false,
  database: false,
  port: false,
  server: false,
  vite: false,
  final: false
};

const shutdownPhases: ShutdownPhases = {
  initiated: false,
  requests_drained: false,
  port_status_cleaned: false,
  database_cleaned: false,
  server_closed: false
};

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
import { setupAuth } from "./auth.js";

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

// Basic middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Setup authentication
setupAuth(app);

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

// Update the writePortStatus function with better error handling and logging
async function writePortStatus(
  port: number,
  ready: boolean = false,
  health: Partial<PortStatus['health']> = {}
): Promise<void> {
  if (typeof port !== 'number') {
    console.error('[Server] Invalid port type:', typeof port);
    return;
  }

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

async function cleanupPortStatus() {
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
}

// Add enhanced port conflict detection
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    let timeoutId: NodeJS.Timeout;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      tester.removeAllListeners();
      try {
        tester.close();
      } catch (err) {
        // Ignore errors during cleanup
      }
    };

    tester
      .once('error', (err: NodeJS.ErrnoException) => {
        cleanup();
        if (err.code === 'EADDRINUSE') {
          console.log(`[Server] Port ${port} is already in use`);
        } else {
          console.log(`[Server] Port ${port} check failed:`, err.code);
        }
        resolve(false);
      })
      .once('listening', () => {
        cleanup();
        console.log(`[Server] Port ${port} is available`);
        resolve(true);
      });

    // Set a shorter timeout for port check
    timeoutId = setTimeout(() => {
      cleanup();
      console.log(`[Server] Port ${port} check timed out`);
      resolve(false);
    }, 1000);

    try {
      tester.listen(port, '0.0.0.0');
    } catch (err) {
      cleanup();
      console.error(`[Server] Error during port check:`, err);
      resolve(false);
    }
  });
}

// Update findAvailablePort to be more robust
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
        // Initial port status write
        await writePortStatus(port, false, {
          database: false,
          vite: false,
          server: false
        });
        return port;
      }
      console.log(`[Server] Port ${port} is in use, trying next port...`);
    } catch (error) {
      console.error(`[Server] Error checking port ${port}:`, error);
    }
  }

  throw new Error(`No available ports found between ${startPort} and ${startPort + maxAttempts - 1}`);
}

// Enhance the waitForServerReady function with better timeout handling
function waitForServerReady(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[Server] Waiting for server readiness on port ${port}...`);
    let attempts = 0;
    const maxAttempts = 60; // Increased to 60 attempts (6 seconds total)
    const checkInterval = 100; // Check every 100ms
    let lastHealthUpdate = Date.now();
    const minUpdateInterval = 1000; // Minimum 1 second between status updates
    let readinessReported = false;

    const check = async () => {
      try {
        const response = await fetch(`http://${HOST}:${port}/api/health`);
        const health = await response.json();

        if (response.ok && health.status === 'healthy') {
          if (!readinessReported) {
            const now = Date.now();
            if (now - lastHealthUpdate >= minUpdateInterval) {
              await writePortStatus(port, true, {
                database: true,
                vite: viteSetupComplete,
                server: true
              });
              lastHealthUpdate = now;
            }

            clearInterval(interval);
            isServerReady = true;
            readinessReported = true;
            console.log(`[Server] Server is ready on port ${port}`);
            resolve();
            return;
          }
        } else {
          console.log(`[Server] Health check response: ${JSON.stringify(health)}`);
        }
      } catch (error) {
        if (attempts % 10 === 0) { // Log every 10th attempt
          console.log(`[Server] Waiting for readiness (attempt ${attempts}/${maxAttempts})`);
        }
      }

      attempts++;
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        if (!readinessReported) {
          console.warn('[Server] Server readiness check timed out, but continuing...');
          isServerReady = true;
          await writePortStatus(port, true, {
            database: true,
            vite: viteSetupComplete,
            server: true
          });
          readinessReported = true;
          resolve(); // Resolve anyway to prevent hanging
        }
      }
    };

    const interval = setInterval(check, checkInterval);
    check(); // Run first check immediately
  });
}

// Add retry mechanism for database connection
async function testDatabaseConnectionWithRetry(maxRetries = 3, backoffMs = 1000): Promise<void> {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      await testConnection();
      console.log('[Server] Database connection successful');
      return;
    } catch (error) {
      attempt++;
      console.error(`[Server] Database connection attempt ${attempt}/${maxRetries} failed:`, error);

      if (attempt === maxRetries) {
        throw new Error(`Database connection failed after ${maxRetries} attempts`);
      }

      // Exponential backoff
      const delay = backoffMs * Math.pow(2, attempt - 1);
      console.log(`[Server] Waiting ${delay}ms before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Enhanced port status validation
async function validateStartupPhase(currentPhase: keyof typeof startupPhases, requiredPhases: (keyof typeof startupPhases)[] = []): Promise<void> {
  // Verify required phases are complete
  const incompletePhases = requiredPhases.filter(phase => !startupPhases[phase]);

  if (incompletePhases.length > 0) {
    throw new Error(`Cannot proceed with ${currentPhase}: required phases not complete: ${incompletePhases.join(', ')}`);
  }

  // Update current phase status
  startupPhases[currentPhase] = true;

  // Log phase completion
  console.log(`[Server] Startup phase '${currentPhase}' completed successfully`);
}


// Enhance startServer function with better error handling
async function startServer() {
  let retries = 3;

  while (retries > 0) {
    try {
      console.log(`[Server] Starting server (attempt ${4 - retries}/3)...`);

      // Phase 1: Cleanup
      console.log('[Server] Phase 1: Cleaning up stale port status...');
      await cleanupPortStatus();
      await validateStartupPhase('cleanup');

      // Phase 2: Database with retry
      console.log('[Server] Phase 2: Testing database connection...');
      await testDatabaseConnectionWithRetry(5, 2000); // More retries, longer backoff
      await validateStartupPhase('database', ['cleanup']);

      // Phase 3: Port allocation
      console.log('[Server] Phase 3: Finding available port...');
      try {
        serverPort = await findAvailablePort(preferredPort);
      } catch (error) {
        console.error('[Server] Port allocation failed:', error);
        throw error;
      }
      await validateStartupPhase('port', ['cleanup', 'database']);

      // Initial port status
      await writePortStatus(serverPort, false, {
        database: true,
        vite: viteSetupComplete,
        server: false
      });

      // Phase 4: Server startup
      console.log(`[Server] Phase 4: Starting HTTP server on ${HOST}:${serverPort}...`);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Server startup timeout'));
        }, STARTUP_PHASE_TIMEOUT);

        server.listen({ port: serverPort, host: HOST }, () => {
          clearTimeout(timeout);
          console.log(`[Server] Server is running at http://${HOST}:${serverPort}`);
          resolve();
        });

        server.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      await validateStartupPhase('server', ['cleanup', 'database', 'port']);

      // Wait for server to be ready
      await waitForServerReady(serverPort);
      console.log(`[Server] Server is fully initialized and ready on port ${serverPort}`);

      // Final status update
      await writePortStatus(serverPort, true, {
        database: true,
        server: true,
        vite: viteSetupComplete
      });

      return; // Success, exit retry loop
    } catch (error) {
      console.error(`[Server] Startup attempt ${4 - retries}/3 failed:`, error);
      retries--;

      if (retries === 0) {
        console.error('[Server] All startup attempts failed');
        if (serverPort) {
          await fs.promises.unlink(PORT_STATUS_FILE).catch(() => {});
        }
        process.exit(1);
      }

      console.log(`[Server] Retrying in 5 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Update the health check endpoint for better error handling
app.get('/api/health', async (req, res) => {
  try {
    const dbStart = Date.now();
    await testConnection();
    const dbDuration = Date.now() - dbStart;

    const status = {
      status: 'healthy',
      port: serverPort,
      ready: isServerReady,
      mode: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      diagnostics: {
        database_response_time: `${dbDuration}ms`,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
      phases: {
        startup: startupPhases,
        shutdown: shutdownPhases
      },
      database: {
        connected: true,
        url: process.env.DATABASE_URL ? 'configured' : 'missing'
      },
      vite: {
        setup: viteSetupComplete
      }
    };

    // Update port status file
    await writePortStatus(serverPort!, isServerReady, {
      database: true,
      vite: viteSetupComplete,
      server: true
    });

    res.json(status);
  } catch (error) {
    console.error('[Server] Health check error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: {
        message: errorMessage,
        code: error instanceof Error ? error.name : 'UnknownError'
      },
      phases: {
        startup: startupPhases,
        shutdown: shutdownPhases
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

// Development mode setup with better error handling
if (process.env.NODE_ENV !== "production") {
  console.log('[Server] Setting up Vite middleware for development...');
  setupVite(app, server)
    .then(() => {
      console.log('[Server] Vite middleware setup complete');
      viteSetupComplete = true;
      if (serverPort) {
        writePortStatus(serverPort, isServerReady, {
          database: true,
          vite: true,
          server: true
        });
      }
      startServer();
    })
    .catch((error) => {
      console.error('[Server] Critical error setting up Vite:', error);
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

// Add cleanup handler with timeout
let shutdownTimeoutId: NodeJS.Timeout | undefined;

async function shutdown() {
  console.log('[Server] Initiating graceful shutdown...');
  console.log(`[Server] Active requests: ${activeRequests}`);

  const startTime = Date.now();
  shutdownPhases.initiated = true;

  try {
    // Set a maximum wait time for active requests
    const forceShutdown = new Promise((_, reject) => {
      shutdownTimeoutId = setTimeout(() => {
        const timeElapsed = Date.now() - startTime;
        reject(new Error(`Shutdown timeout after ${timeElapsed}ms with ${activeRequests} pending requests`));
      }, 10000); // 10 second timeout
    });

    // Wait for active requests to complete with progress logging
    const gracefulShutdown = new Promise<void>(async (resolve) => {
      console.log(`[Server] Waiting for ${activeRequests} active requests to complete...`);

      while (activeRequests > 0) {
        const elapsed = Date.now() - startTime;
        console.log(`[Server] Still waiting on ${activeRequests} requests after ${elapsed}ms`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log('[Server] All active requests completed');
      shutdownPhases.requests_drained = true;
      resolve();
    });

    // Wait for either graceful shutdown or timeout
    await Promise.race([gracefulShutdown, forceShutdown]);


    // Remove port status file with retries
    let retries = 3;
    while (retries > 0) {
      try {
        await fs.promises.unlink(PORT_STATUS_FILE);
        console.log('[Server] Successfully removed port status file');
        shutdownPhases.port_status_cleaned = true;
        break;
      } catch (error) {
        if (retries === 1) {
          console.error('[Server] Failed to remove port status file after all retries');
        } else {
          console.log(`[Server] Retry ${4 - retries}/3 removing port status file`);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        retries--;
      }
    }

    // Cleanup database connections
    try {
      await dbCleanup();
      console.log('[Server] Database connections cleaned up successfully');
      shutdownPhases.database_cleaned = true;
    } catch (error) {
      console.error('[Server] Error cleaning up database connections:', error);
      throw error;
    }

    // Close the server with a timeout and detailed error handling
    await new Promise<void>((resolve, reject) => {
      const serverTimeout = setTimeout(() => {
        reject(new Error('Server close operation timed out after 5000ms'));
      }, 5000);

      server.close((err) => {
        clearTimeout(serverTimeout);
        if (err) {
          console.error('[Server] Error while closing server:', err);
          reject(err);
        } else {
          console.log('[Server] Server closed successfully');
          shutdownPhases.server_closed = true;
          resolve();
        }
      });
    });

    const totalTime = Date.now() - startTime;
    console.log(`[Server] Graceful shutdown completed in ${totalTime}ms`);
    console.log('[Server] Final shutdown phase status:', shutdownPhases);
    process.exit(0);
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[Server] Error during shutdown after ${totalTime}ms:`, error);
    console.error('[Server] Shutdown phases at error:', shutdownPhases);
    process.exit(1);
  } finally {
    if (shutdownTimeoutId) {
      clearTimeout(shutdownTimeoutId);
    }
  }
}

process.on('SIGTERM', () => {
  console.log('[Server] Received SIGTERM signal');
  const forceShutdownTimeout = setTimeout(() => {
    console.error('[Server] Forced shutdown due to timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  shutdown().finally(() => clearTimeout(forceShutdownTimeout));
});

process.on('SIGINT', () => {
  console.log('[Server] Received SIGINT signal');
  const forceShutdownTimeout = setTimeout(() => {
    console.error('[Server] Forced shutdown due to timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  shutdown().finally(() => clearTimeout(forceShutdownTimeout));
});