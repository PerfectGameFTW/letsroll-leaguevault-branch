const STARTUP_PHASE_TIMEOUT = 30000; // 30 seconds
const SHUTDOWN_TIMEOUT = 30000; // 30 seconds

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
import { setupAuth } from "./auth.js"; // Added import

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

// Setup authentication  //Added authentication middleware setup
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

// Update the startServer function to use new safeguards
const preferredPort = parseInt(process.env.PORT || '3000');
const HOST = '0.0.0.0';

async function startServer() {
  try {
    console.log('[Server] Starting server initialization...');

    // Phase 1: Cleanup
    console.log('[Server] Phase 1: Cleaning up stale port status...');
    await cleanupPortStatus();
    await validateStartupPhase('cleanup');

    // Phase 2: Database with retry
    console.log('[Server] Phase 2: Testing database connection...');
    await testDatabaseConnectionWithRetry();
    await validateStartupPhase('database', ['cleanup']);

    // Phase 3: Port allocation - Use process.env.PORT or fallback
    console.log('[Server] Phase 3: Allocating port...');
    const port = preferredPort;
    serverPort = port;
    await validateStartupPhase('port', ['cleanup', 'database']);

    // Update port status with health indicators
    await writePortStatus(port, false, {
      database: true,
      vite: viteSetupComplete,
      server: false
    });

    // Phase 4: Server startup with proper host binding
    console.log('[Server] Phase 4: Starting HTTP server...');

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, STARTUP_PHASE_TIMEOUT);

      server.listen(port, HOST, async () => {
        clearTimeout(timeout);
        console.log(`[Server] Server is running at http://${HOST}:${port}`);
        await validateStartupPhase('server', ['cleanup', 'database', 'port']);

        await writePortStatus(port, true, {
          database: true,
          vite: viteSetupComplete,
          server: true
        });
        resolve();
      });

      server.once('error', (err) => {
        clearTimeout(timeout);
        console.error('[Server] Failed to start server:', err);
        reject(err);
      });
    });

    // Wait for server to be fully ready
    await waitForServerReady(serverPort);

    console.log(`[Server] Server is fully initialized and ready on port ${serverPort}`);
    isServerReady = true;

    // Final port status update
    await writePortStatus(serverPort, true, { 
      database: true, 
      server: true,
      vite: viteSetupComplete 
    });

  } catch (error) {
    console.error('[Server] Fatal error during startup:', error);
    // Cleanup port status file on error
    if (serverPort) {
      await fs.promises.unlink(PORT_STATUS_FILE).catch(() => {});
    }
    process.exit(1);
  }
}

// Enhanced shutdown function with phase tracking
// Fix for shutdownTimeoutId initialization and usage
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

// Update health check endpoint to include shutdown status
app.get('/api/health', async (req, res) => {
  try {
    await testConnection();
    const status = {
      status: 'healthy',
      port: serverPort,
      ready: isServerReady,
      mode: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
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
    res.status(503).json({
      status: 'unhealthy',
      phases: {
        startup: startupPhases,
        shutdown: shutdownPhases
      },
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
      // Update port status after Vite setup
      if (serverPort) {
        writePortStatus(serverPort, true, {
          database: true,
          vite: true,
          server: true
        });
      }
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

// Add cleanup handler with timeout
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