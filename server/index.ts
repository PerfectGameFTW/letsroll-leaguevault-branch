const HOST = '0.0.0.0';
const preferredPort = 5000;

// Add constant for logging cleanup
const LOG_PREFIX = '[Server]';
const DB_LOG_PREFIX = '[Database]';

// Update the log function
export function log(message: string, source = LOG_PREFIX, level: 'info' | 'error' | 'warn' = 'info') {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const logFn = level === 'error' ? console.error :
                level === 'warn' ? console.warn :
                console.log;

  logFn(`${formattedTime} ${source} ${message}`);
}

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
      log(`Slow request: ${req.method} ${req.path} took ${duration}ms`);
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
  log(`${req.method} ${req.originalUrl} on port ${serverPort}`, LOG_PREFIX);

  if (req.body && Object.keys(req.body).length > 0) {
    log(`Request body: ${JSON.stringify(req.body, null, 2)}`, LOG_PREFIX);
  }

  const oldJson = res.json;
  res.json = function(body) {
    log(`Response body: ${JSON.stringify(body)}`, LOG_PREFIX);
    return oldJson.call(this, body);
  };

  res.on('finish', () => {
    log(`${req.method} ${req.originalUrl} ${res.statusCode} (${Date.now() - start}ms)`, LOG_PREFIX);
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
    log(`Invalid port type: ${typeof port}`, LOG_PREFIX, 'error');
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
    log(`Updated port status: ${JSON.stringify(status)}`);
  } catch (error) {
    log(`Error writing port status: ${error}`, LOG_PREFIX, 'error');
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
    log(`Error cleaning up stale port status: ${error}`, LOG_PREFIX, 'error');
  }
};

async function cleanupPortStatus() {
  try {
    // First check if the file exists
    if (!fs.existsSync(PORT_STATUS_FILE)) {
      return;
    }

    // Attempt to read existing port status
    const existingStatus = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8')
      .then(content => JSON.parse(content) as PortStatus)
      .catch(() => null);

    if (existingStatus) {
      // Check if the process is still running
      try {
        process.kill(existingStatus.pid, 0);
        log(`Found existing server process (PID: ${existingStatus.pid})`);

        // If process exists and port status is recent (within last minute)
        const isRecent = Date.now() - new Date(existingStatus.timestamp).getTime() < 60000;
        if (!isRecent) {
          // Process exists but status is stale, safe to cleanup
          await fs.promises.unlink(PORT_STATUS_FILE);
          log('Cleaned up stale port status file');
        }
      } catch (e) {
        // Process doesn't exist, safe to cleanup
        await fs.promises.unlink(PORT_STATUS_FILE);
        log('Cleaned up orphaned port status file');
      }
    } else {
      // Invalid or corrupted status file, safe to remove
      await fs.promises.unlink(PORT_STATUS_FILE);
      log('Removed invalid port status file');
    }
  } catch (error) {
    log(`Warning during port status cleanup: ${error}`, LOG_PREFIX, 'warn');
    // Continue even if cleanup fails
  }
}

// Add enhanced port conflict detection
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          log(`Port ${port} is in use`);
        } else {
          log(`Error checking port ${port}: ${err.message}`, LOG_PREFIX, 'warn');
        }
        resolve(false);
      })
      .once('listening', () => {
        tester.once('close', () => resolve(true));
        tester.close();
      })
      .listen(port, HOST);

    // Quick timeout for port check
    setTimeout(() => {
      tester.removeAllListeners();
      tester.close();
      resolve(false);
    }, 1000); // Increased timeout for more reliable checks
  });
}

// Update findAvailablePort to be more robust
async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
  log(`Looking for available port starting from ${startPort}...`);

  // Clean up any stale port status before starting
  await cleanupStalePortStatus();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = startPort + attempt;

    try {
      // Test if port is already registered in status file
      if (fs.existsSync(PORT_STATUS_FILE)) {
        const status = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8')
          .then(content => JSON.parse(content))
          .catch(() => null);

        if (status && status.port === port) {
          log(`Port ${port} is registered in status file, skipping...`);
          continue;
        }
      }

      const isAvailable = await isPortAvailable(port);
      if (isAvailable) {
        log(`Found available port: ${port}`);
        // Initial port status write
        await writePortStatus(port, false, {
          database: false,
          vite: false,
          server: false
        });
        return port;
      }
      log(`Port ${port} is in use, trying next port...`);
    } catch (error) {
      log(`Error checking port ${port}: ${error}`, LOG_PREFIX, 'warn');
      // Continue to next port even if there's an error
      continue;
    }
  }

  const error = new Error(`No available ports found between ${startPort} and ${startPort + maxAttempts - 1}`);
  log(error.message, LOG_PREFIX, 'error');
  throw error;
}

// Function to wait for the server to be ready
function waitForServerReady(port: number): Promise<void> {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 30;
    let readinessChecked = false;

    const checkInterval = setInterval(async () => {
      if (readinessChecked) return;

      attempts++;
      try {
        const response = await fetch(`http://localhost:${port}/api/health`);
        if (response.ok) {
          const health = await response.json();
          if (health.status === 'healthy' && health.database.connected) {
            readinessChecked = true;
            clearInterval(checkInterval);
            isServerReady = true;
            log(`Server is ready on port ${port}`);

            // Single status update on success
            await writePortStatus(port, true, {
              database: true,
              vite: viteSetupComplete,
              server: true
            });

            resolve();
          }
        }
      } catch (error) {
        if (attempts % 5 === 0) {
          log(`Still waiting for readiness (attempt ${attempts}/${maxAttempts})...`);
        }
      }

      if (attempts >= maxAttempts) {
        readinessChecked = true;
        clearInterval(checkInterval);
        log('Reached maximum readiness check attempts');

        // Final status update on timeout
        await writePortStatus(port, true, {
          database: true,
          vite: viteSetupComplete,
          server: true
        });

        resolve();
      }
    }, 100);
  });
}

// Add retry mechanism for database connection
async function testDatabaseConnectionWithRetry(maxRetries = 5, backoffMs = 1000): Promise<void> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxRetries) {
    try {
      await testConnection();
      log('Database connection successful');
      return;
    } catch (error) {
      attempt++;
      lastError = error instanceof Error ? error : new Error('Unknown error');
      log(`Database connection attempt ${attempt}/${maxRetries} failed: ${lastError.message}`, DB_LOG_PREFIX, 'error');

      if (attempt === maxRetries) {
        log('All database connection attempts failed', DB_LOG_PREFIX, 'error');
        throw lastError;
      }

      const delay = backoffMs * Math.pow(2, attempt - 1);
      log(`Waiting ${delay}ms before next attempt...`, DB_LOG_PREFIX, 'warn');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Enhanced shutdown with better cleanup

async function startServer() {
  try {
    log('Starting server initialization...');

    // Phase 1: Cleanup
    log('Phase 1: Cleaning up stale port status...');
    await cleanupPortStatus();
    await validateStartupPhase('cleanup');

    // Phase 2: Database with retry
    log('Phase 2: Testing database connection...');
    await testDatabaseConnectionWithRetry();
    await validateStartupPhase('database', ['cleanup']);

    // Phase 3: Port allocation with resilient port finding
    log('Phase 3: Finding available port...');
    try {
      serverPort = await findAvailablePort(preferredPort);
    } catch (error) {
      log('Failed to find available port:', LOG_PREFIX, 'error');
      throw error;
    }
    await validateStartupPhase('port', ['cleanup', 'database']);

    // Update port status with health indicators
    await writePortStatus(serverPort, false, {
      database: true,
      vite: viteSetupComplete,
      server: false
    });

    // Phase 4: Server startup with proper host binding
    log(`Phase 4: Starting HTTP server on ${HOST}:${serverPort}...`);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, STARTUP_PHASE_TIMEOUT);

      server.listen({
        port: serverPort,
        host: HOST
      }, () => {
        clearTimeout(timeout);
        log(`Server is running at http://${HOST}:${serverPort}`);
        resolve();
      });

      server.once('error', (err) => {
        clearTimeout(timeout);
        log('Failed to start server:', LOG_PREFIX, 'error');
        reject(err);
      });
    });

    await validateStartupPhase('server', ['cleanup', 'database', 'port']);

    // Wait for server to be fully ready
    await waitForServerReady(serverPort);
    log(`Server is fully initialized and ready on port ${serverPort}`);
    isServerReady = true;

    // Final port status update
    await writePortStatus(serverPort, true, {
      database: true,
      server: true,
      vite: viteSetupComplete
    });

  } catch (error) {
    log('Fatal error during startup:', LOG_PREFIX, 'error');
    // Cleanup port status file on error
    if (serverPort) {
      await fs.promises.unlink(PORT_STATUS_FILE).catch(() => {});
    }
    process.exit(1);
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
  log(`Startup phase '${currentPhase}' completed successfully`);
}

// Enhanced shutdown function with phase tracking
// Fix for shutdownTimeoutId initialization and usage
let shutdownTimeoutId: NodeJS.Timeout | undefined;

async function shutdown() {
  log('Initiating graceful shutdown...');
  log(`Active requests: ${activeRequests}`);

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
      log(`Waiting for ${activeRequests} active requests to complete...`);

      while (activeRequests > 0) {
        const elapsed = Date.now() - startTime;
        log(`Still waiting on ${activeRequests} requests after ${elapsed}ms`, LOG_PREFIX, 'warn');
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      log('All active requests completed');
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
        log('Successfully removed port status file');
        shutdownPhases.port_status_cleaned = true;
        break;
      } catch (error) {
        if (retries === 1) {
          log('Failed to remove port status file after all retries', LOG_PREFIX, 'error');
        } else {
          log(`Retry ${4 - retries}/3 removing port status file`, LOG_PREFIX, 'warn');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        retries--;
      }
    }

    // Cleanup database connections
    try {
      await dbCleanup();
      log('Database connections cleaned up successfully');
      shutdownPhases.database_cleaned = true;
    } catch (error) {
      log('Error cleaning up database connections:', LOG_PREFIX, 'error');
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
          log('Error while closing server:', LOG_PREFIX, 'error');
          reject(err);
        } else {
          log('Server closed successfully');
          shutdownPhases.server_closed = true;
          resolve();
        }
      });
    });

    const totalTime = Date.now() - startTime;
    log(`Graceful shutdown completed in ${totalTime}ms`);
    log('Final shutdown phase status:', LOG_PREFIX, 'info');
    process.exit(0);
  } catch (error) {
    const totalTime = Date.now() - startTime;
    log(`Error during shutdown after ${totalTime}ms: ${error}`, LOG_PREFIX, 'error');
    log('Shutdown phases at error:', LOG_PREFIX, 'error');
    process.exit(1);
  } finally {
    if (shutdownTimeoutId) {
      clearTimeout(shutdownTimeoutId);
    }
  }
}

// Update health check endpoint to include shutdown status
app.get('/api/health', async (req: Request, res: Response) => {
  let retries = 3;
  let lastError = null;

  while (retries > 0) {
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
      if (serverPort) {
        await writePortStatus(serverPort, isServerReady, {
          database: true,
          vite: viteSetupComplete,
          server: true
        });
      }

      return res.json(status);
    } catch (error) {
      lastError = error;
      retries--;
      if (retries > 0) {
        log(`Health check retry ${3 - retries}/3`, LOG_PREFIX, 'warn');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  log('Health check error after retries:', LOG_PREFIX, 'error');
  log(lastError instanceof Error ? lastError.message : 'Unknown error', LOG_PREFIX, 'error');

  res.status(503).json({
    status: 'unhealthy',
    phases: {
      startup: startupPhases,
      shutdown: shutdownPhases
    },
    error: {
      message: lastError instanceof Error ? lastError.message : 'Unknown error',
      code: lastError instanceof Error ? lastError.name : 'UnknownError',
      timestamp: new Date().toISOString()
    }
  });
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
log('Registering API routes...');
registerRoutes(app);

// Development mode setup
if (process.env.NODE_ENV !== "production") {
  log('Setting up Vite middleware for development...');
  try {
    await setupVite(app, server);
    log('Vite middleware setup complete');
    viteSetupComplete = true;
    // Update port status after Vite setup
    if (serverPort) {
      await writePortStatus(serverPort, true, {
        database: true,
        vite: true,
        server: true
      });
    }
    await startServer();
  } catch (error) {
    log('Fatal error setting up Vite:', LOG_PREFIX, 'error');
    process.exit(1);
  }
} else {
  // Production mode setup
  app.use(express.static(path.join(process.cwd(), 'dist/public')));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(process.cwd(), 'dist/public/index.html'));
  });
  await startServer();
}

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  log('Error', LOG_PREFIX, 'error', err);
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
  log('Received SIGTERM signal');
  const forceShutdownTimeout = setTimeout(() => {
    log('Forced shutdown due to timeout', LOG_PREFIX, 'error');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  shutdown().finally(() => clearTimeout(forceShutdownTimeout));
});

process.on('SIGINT', () => {
  log('Received SIGINT signal');
  const forceShutdownTimeout = setTimeout(() => {
    log('Forced shutdown due to timeout', LOG_PREFIX, 'error');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  shutdown().finally(() => clearTimeout(forceShutdownTimeout));
});