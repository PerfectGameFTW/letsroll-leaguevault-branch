// Very first logging to verify script execution and environment
console.log('\n=== Server Initialization Starting ===');
console.log('Process Info:', {
  pid: process.pid,
  ppid: process.ppid,
  cwd: process.cwd(),
  argv: process.argv
});

// Debug configuration
const DEBUG = process.env.DEBUG !== '0' || process.env.REPL_WORKFLOW_NAME === 'Dev';
function debugLog(context: string, message: string, data?: any) {
  if (DEBUG) {
    console.log(`[DEBUG][${context}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

// Add process event handlers early
process.on('SIGHUP', () => {
  console.log('[Server] Received SIGHUP signal');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Very first logging to verify script execution
console.log('[Server] Starting script execution...');

// Early environment logging
console.log('[Server] Initial environment check:', {
  NODE_ENV: process.env.NODE_ENV,
  WORKFLOW: process.env.REPL_WORKFLOW_NAME,
  DEBUG: DEBUG
});

console.log('=== Server Startup Diagnostics ===');
console.log('Environment:', {
  NODE_ENV: process.env.NODE_ENV,
  REPL_WORKFLOW_NAME: process.env.REPL_WORKFLOW_NAME,
  npm_lifecycle_event: process.env.npm_lifecycle_event,
  DEBUG: process.env.DEBUG,
  PORT: process.env.PORT
});

// Add explicit port information
console.log('[Server] Will attempt to bind to ports in range:', {
  preferredPort: process.env.PORT || 5001,
  availablePorts: '5001-5010',
  host: '0.0.0.0'
});

// Add more detailed startup logging
console.log('[Server] Starting server initialization...');
debugLog('Startup', 'Beginning server initialization', {
  time: new Date().toISOString(),
  env: process.env.NODE_ENV,
  workflow: process.env.REPL_WORKFLOW_NAME
});

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
import { paymentScheduler } from './services/payment-scheduler.js';

const STARTUP_PHASE_TIMEOUT = 30000; // 30 seconds
const SHUTDOWN_TIMEOUT = 60000; // 60 seconds
const HOST = '0.0.0.0';
const preferredPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 5001;

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

const app = express();
const server = createServer(app);
let viteSetupComplete = false;
let serverPort: number | null = null;
let isServerReady = false;

const PORT_STATUS_FILE = '.port-status';
const STALE_PORT_TIMEOUT = 60000; // 60 seconds
let activeRequests = 0;
const requestTracker = (req: Request, res: Response, next: NextFunction) => {
  activeRequests++;
  res.on('finish', () => {
    activeRequests--;
  });
  next();
};

app.use(requestTracker);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
setupAuth(app);
app.use(async (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  debugLog('Request', `${req.method} ${req.path}`, {
    headers: req.headers,
    query: req.query,
    workflow: process.env.REPL_WORKFLOW_NAME || 'unknown'
  });

  res.on('finish', async () => {
    const duration = Date.now() - start;
    debugLog('Response', `${req.method} ${req.path} completed in ${duration}ms`);
  });

  next();
});

app.use((req, res, next) => {
  if (req.path.includes('/@vite') || req.path.includes('vite-hmr')) {
    return next();
  }

  const start = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[${requestId}] ${req.method} ${req.originalUrl} on port ${serverPort}`);
  console.log(`[${requestId}] Request headers:`, req.headers);

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

const getWorkflowName = () => {
  const npmScript = process.env.npm_lifecycle_event;
  const replWorkflow = process.env.REPL_WORKFLOW_NAME;
  const replSlug = process.env.REPL_SLUG;
  const isDev = process.env.NODE_ENV === 'development' || npmScript === 'dev';

  debugLog('Workflow', 'Detecting current workflow', {
    npm_lifecycle_event: npmScript,
    REPL_WORKFLOW_NAME: replWorkflow,
    REPL_SLUG: replSlug,
    NODE_ENV: process.env.NODE_ENV,
    isDev,
    pwd: process.env.PWD,
    path: process.env.PATH?.split(':')[0]
  });

  if (isDev) {
    debugLog('Workflow', 'Detected Dev workflow from development environment');
    return 'Dev';
  }

  if (replWorkflow) {
    debugLog('Workflow', `Using explicit workflow name: ${replWorkflow}`);
    return replWorkflow;
  }

  if (replSlug === 'workspace' && process.env.NODE_ENV === 'development') {
    debugLog('Workflow', 'Mapped workspace to Dev workflow in development');
    return 'Dev';
  }

  debugLog('Workflow', 'Using default workflow name');
  return replSlug || 'Unknown';
};

const INSTANCE_LOCK_FILE = '.server-instance.lock';

async function acquireInstanceLock(): Promise<boolean> {
  const currentWorkflow = getWorkflowName();

  try {
    const lockData = {
      pid: process.pid,
      timestamp: new Date().toISOString(),
      workflow: currentWorkflow,
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        npm_lifecycle_event: process.env.npm_lifecycle_event
      }
    };

    debugLog('Instance', 'Attempting to acquire lock', lockData);

    await fs.promises.writeFile(
      INSTANCE_LOCK_FILE,
      JSON.stringify(lockData),
      { flag: 'wx' } // Fail if file exists
    );

    debugLog('Instance', 'Successfully acquired lock', lockData);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      try {
        const existing = JSON.parse(
          await fs.promises.readFile(INSTANCE_LOCK_FILE, 'utf-8')
        );

        debugLog('Instance', 'Found existing lock', existing);

        if (existing.workflow !== currentWorkflow) {
          debugLog('Instance', 'Lock belongs to different workflow, allowing concurrent execution', {
            current: currentWorkflow,
            existing: existing.workflow
          });
          return true;
        }

        try {
          process.kill(existing.pid, 0);
          debugLog('Instance', 'Found running instance of same workflow', existing);
          return false;
        } catch {
          debugLog('Instance', 'Found stale lock, cleaning up', existing);
          await fs.promises.unlink(INSTANCE_LOCK_FILE);
          return acquireInstanceLock();
        }
      } catch (err) {
        debugLog('Instance', 'Found invalid lock file, cleaning up');
        await fs.promises.unlink(INSTANCE_LOCK_FILE);
        return acquireInstanceLock();
      }
    }
    debugLog('Instance', 'Failed to acquire lock', { error });
    return false;
  }
}

async function releaseInstanceLock() {
  try {
    await fs.promises.unlink(INSTANCE_LOCK_FILE);
    debugLog('Instance', 'Released server instance lock');
  } catch (error) {
    debugLog('Instance', 'Error releasing lock', { error });
  }
}

async function writePortStatus(
  port: number,
  ready: boolean = false,
  health: Partial<PortStatus['health']> = {}
): Promise<void> {
  debugLog('PortStatus', `Updating port status for port ${port}`, { ready, health });

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
      workflow: getWorkflowName(),
      health: {
        database: health.database || false,
        vite: health.vite || false,
        server: health.server || false
      }
    };

    try {
      const existingStatus = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8');
      debugLog('PortStatus', 'Existing port status:', JSON.parse(existingStatus));
    } catch (err) {
      debugLog('PortStatus', 'No existing port status file');
    }

    await fs.promises.writeFile(PORT_STATUS_FILE, JSON.stringify(status, null, 2));
    debugLog('PortStatus', 'Successfully wrote port status:', status);
  } catch (error) {
    console.error('[Server] Error writing port status:', error);
    debugLog('PortStatus', 'Error writing status:', error);
  }
}

async function cleanupPortStatus() {
  debugLog('Cleanup', 'Starting port status cleanup');
  try {
    const psCommand = process.platform === 'win32'
      ? `tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH`
      : `ps aux | grep node`;

    try {
      const processes = require('child_process').execSync(psCommand, { encoding: 'utf-8' });
      debugLog('Cleanup', 'Running Node processes:', processes);
    } catch (e) {
      debugLog('Cleanup', 'Error checking processes:', e);
    }

    await fs.promises.unlink(PORT_STATUS_FILE).catch((err) => {
      debugLog('Cleanup', 'Error removing port status file:', err);
    });

    debugLog('Cleanup', 'Port status cleanup completed');
  } catch (error) {
    console.error('[Server] Error during port status cleanup:', error);
    debugLog('Cleanup', 'Cleanup error:', error);
  }
}

const cleanupStalePortStatus = async () => {
  try {
    const status = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8')
      .then(content => JSON.parse(content) as { pid: number; timestamp: string })
      .catch(() => null);

    if (status) {
      const timestampAge = Date.now() - new Date(status.timestamp).getTime();

      try {
        process.kill(status.pid, 0); 
        if (timestampAge < STALE_PORT_TIMEOUT) {
          throw new Error('Port is in use by another active process');
        }
      } catch (e) {
        await fs.promises.unlink(PORT_STATUS_FILE).catch(() => {});
      }
    }
  } catch (error) {
    console.error('[Server] Error cleaning up stale port status:', error);
  }
};

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

async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
  console.log(`[Server] Looking for available port starting from ${startPort}...`);

  await cleanupStalePortStatus();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = startPort + attempt;

    try {
      const isAvailable = await isPortAvailable(port);
      if (isAvailable) {
        console.log(`[Server] Found available port: ${port}`);
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

function waitForServerReady(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[Server] Waiting for server readiness on port ${port}...`);
    let attempts = 0;
    const maxAttempts = 30; 
    const checkInterval = 100; 

    const check = async () => {
      try {
        const response = await fetch(`http://${HOST}:${port}/api/health`);
        const health = await response.json();

        if (response.ok && health.status === 'healthy') {
          clearInterval(interval);
          isServerReady = true;
          console.log(`[Server] Server is ready on port ${port}`);
          resolve();
          return;
        }
      } catch (error) {
        attempts++;
        if (attempts % 5 === 0) { 
          console.log(`[Server] Waiting for readiness (attempt ${attempts}/${maxAttempts})`);
        }
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        console.warn('[Server] Server readiness check timed out, but continuing...');
        isServerReady = true;
        resolve(); 
      }
    };

    const interval = setInterval(check, checkInterval);
    check(); 
  });
}

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

      const delay = backoffMs * Math.pow(2, attempt - 1);
      console.log(`[Server] Waiting ${delay}ms before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function validateStartupPhase(currentPhase: keyof typeof startupPhases, requiredPhases: (keyof typeof startupPhases)[] = []): Promise<void> {
  const incompletePhases = requiredPhases.filter(phase => !startupPhases[phase]);

  if (incompletePhases.length > 0) {
    throw new Error(`Cannot proceed with ${currentPhase}: required phases not complete: ${incompletePhases.join(', ')}`);
  }

  startupPhases[currentPhase] = true;

  console.log(`[Server] Startup phase '${currentPhase}' completed successfully`);
}


async function startServer() {
  try {
    console.log('[Server] Starting server...');

    const canStart = await acquireInstanceLock();
    if (!canStart) {
      console.log('[Server] Another server instance is already running');
      process.exit(0);
    }

    process.on('SIGTERM', () => {
      releaseInstanceLock();
      shutdown();
    });

    process.on('SIGINT', () => {
      releaseInstanceLock();
      shutdown();
    });

    await cleanupPortStatus();
    await validateStartupPhase('cleanup');

    const dbConnected = await Promise.race([
      testDatabaseConnectionWithRetry(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database connection timeout')), 5000))
    ]).catch(error => {
      console.warn('[Server] Database connection failed:', error);
      return false;
    });
    await validateStartupPhase('database', ['cleanup']);

    if (dbConnected) {
      try {
        await paymentScheduler.initialize();
        console.log('[Server] Payment scheduler initialized successfully');
      } catch (error) {
        console.error('[Server] Error initializing payment scheduler:', error);
      }
    }

    try {
      serverPort = await findAvailablePort(preferredPort);
    } catch (error) {
      console.error('[Server] Port allocation failed:', error);
      throw error;
    }
    await validateStartupPhase('port', ['cleanup', 'database']);

    await writePortStatus(serverPort, false, {
      database: !!dbConnected, 
      vite: viteSetupComplete,
      server: false
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, 5000);

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

    await waitForServerReady(serverPort);
    console.log(`[Server] Server is fully initialized and ready on port ${serverPort}`);

    await writePortStatus(serverPort, true, {
      database: !!dbConnected, 
      server: true,
      vite: viteSetupComplete
    });

  } catch (error) {
    console.error('[Server] Critical startup error:', error);
    await releaseInstanceLock();
    if (serverPort) {
      await fs.promises.unlink(PORT_STATUS_FILE).catch(() => {});
    }
    process.exit(1);
  }
}

app.get('/api/health', async (req, res) => {
  debugLog('Health', 'Health check requested', {
    port: serverPort,
    workflow: process.env.REPL_WORKFLOW_NAME,
    environment: process.env.NODE_ENV
  });

  try {
    const dbStart = Date.now();
    await testConnection();
    const dbDuration = Date.now() - dbStart;

    const status = {
      status: 'healthy',
      port: serverPort,
      ready: isServerReady,
      mode: process.env.NODE_ENV,
      workflow: getWorkflowName(),
      timestamp: new Date().toISOString(),
      diagnostics: {
        database_response_time: `${dbDuration}ms`,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      }
    };

    debugLog('Health', 'Health check successful', status);
    res.json(status);
  } catch (error) {
    debugLog('Health', 'Health check failed', { error });
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

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

console.log('[Server] Registering API routes...');
registerRoutes(app);

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
  app.use(express.static(path.join(process.cwd(), 'dist/public')));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(process.cwd(), 'dist/public/index.html'));
  });
  startServer();
}

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

let shutdownTimeoutId: NodeJS.Timeout | undefined;

async function shutdown() {
  console.log('[Server] Initiating graceful shutdown...');
  console.log(`[Server] Active requests: ${activeRequests}`);

  const startTime = Date.now();
  shutdownPhases.initiated = true;

  try {
    if (paymentScheduler) {
      console.log('[Server] Cleaning up payment scheduler...');
      paymentScheduler.cancelAllJobs();
    }

    const forceShutdown = new Promise((_, reject) => {
      shutdownTimeoutId = setTimeout(() => {
        const timeElapsed = Date.now() - startTime;
        reject(new Error(`Shutdown timeout after ${timeElapsed}ms with ${activeRequests} pending requests`));
      }, 10000); 
    });

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

    await Promise.race([gracefulShutdown, forceShutdown]);


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

    try {
      await dbCleanup();
      console.log('[Server] Database connections cleaned up successfully');
      shutdownPhases.database_cleaned = true;
    } catch (error) {
      console.error('[Server] Error cleaning up database connections:', error);
      throw error;
    }

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

interface PortStatus {
  port: number;
  ready: boolean;
  timestamp: string;
  pid: number;
  mode: string;
  workflow: string;
  health: {
    database: boolean;
    vite: boolean;
    server: boolean;
  };
}