import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite } from "./vite";
import { testConnection, cleanup as dbCleanup } from "./db";
import { createServer } from 'http';
import { ScoreSchedulerService } from './services/score-scheduler';
import { storage } from './storage';
import path from 'path';
import net from 'net';
import fs from 'fs';
import { setupAuth } from "./auth";
import { paymentScheduler } from './services/payment-scheduler';

// Initialize Express app first
const app = express();
const server = createServer(app);

// Debug configuration
const DEBUG = process.env.DEBUG !== '0';
const WORKFLOW_DEBUG = true; // Force workflow debugging on

function debugWorkflow(context: string, message: string, data?: any) {
  if (WORKFLOW_DEBUG) {
    console.log(`[WORKFLOW][${context}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

// Constants and configuration
const STARTUP_PHASE_TIMEOUT = 30000; // 30 seconds
const SHUTDOWN_TIMEOUT = 60000; // 60 seconds
const HOST = '0.0.0.0';
const REPLIT_WORKSPACE = process.env.REPL_SLUG === 'workspace';
const preferredPort = REPLIT_WORKSPACE ? 5001 : (process.env.PORT ? parseInt(process.env.PORT, 10) : 5001);
const PORT_STATUS_FILE = '.port-status';
const STALE_PORT_TIMEOUT = 60000; // 60 seconds
const INSTANCE_LOCK_FILE = '.server-instance.lock';

// State variables
let viteSetupComplete = false;
let serverPort: number | null = null;
let isServerReady = false;
let portStatusInterval: NodeJS.Timeout;
let activeRequests = 0;

// Interfaces
interface PortStatus {
  port: number;
  ready: boolean;
  timestamp: string;
  pid?: number;
  mode?: string;
  workflow?: string;
  health?: {
    database: boolean;
    vite: boolean;
    server: boolean;
  };
}

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

// Debug configuration with sensible defaults
function debugLog(context: string, message: string, data?: any) {
  if (DEBUG) {
    console.log(`[DEBUG][${context}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

// Request tracking middleware
const requestTracker = (req: Request, res: Response, next: NextFunction) => {
  activeRequests++;
  res.on('finish', () => {
    activeRequests--;
  });
  next();
};

// Setup basic middleware
app.use(requestTracker);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
setupAuth(app);

// Enhanced getWorkflowName function
function getWorkflowName() {
  debugWorkflow('Detection', 'Starting workflow name detection', {
    REPL_SLUG: process.env.REPL_SLUG,
    REPL_WORKFLOW_NAME: process.env.REPL_WORKFLOW_NAME,
    NODE_ENV: process.env.NODE_ENV,
    npm_lifecycle_event: process.env.npm_lifecycle_event
  });

  // Always treat workspace as Dev environment
  if (process.env.REPL_SLUG === 'workspace') {
    debugWorkflow('Detection', 'Detected workspace environment, using Dev workflow');
    return 'Dev';
  }

  // Use explicit workflow name if available
  if (process.env.REPL_WORKFLOW_NAME) {
    debugWorkflow('Detection', `Using explicit workflow name: ${process.env.REPL_WORKFLOW_NAME}`);
    return process.env.REPL_WORKFLOW_NAME;
  }

  // Default to Dev for development environment
  if (process.env.NODE_ENV === 'development' || process.env.npm_lifecycle_event === 'dev') {
    debugWorkflow('Detection', 'Detected development environment');
    return 'Dev';
  }

  // Fallback to a default workflow name
  debugWorkflow('Detection', 'Using default workflow name');
  return 'Dev';
}

// Enhanced writePortStatus function
async function writePortStatus(
  port: number,
  ready: boolean = false,
  health: Partial<PortStatus['health']> = {}
): Promise<void> {
  debugWorkflow('PortStatus', 'Writing port status file...', {
    port,
    ready,
    health,
    cwd: process.cwd(),
    path: path.resolve(PORT_STATUS_FILE),
    is_workspace: REPLIT_WORKSPACE
  });

  const maxRetries = 3;
  let retries = 0;

  while (retries < maxRetries) {
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

      // Write the status file in the current working directory
      const statusPath = path.resolve(process.cwd(), PORT_STATUS_FILE);
      await fs.promises.writeFile(statusPath, JSON.stringify(status, null, 2));
      debugWorkflow('PortStatus', 'Successfully wrote port status:', status);

      // Verify file was written correctly
      const written = await fs.promises.readFile(statusPath, 'utf-8');
      debugWorkflow('PortStatus', 'Verified written status:', JSON.parse(written));
      break;
    } catch (error) {
      console.error('[Server] Error writing port status:', error);
      retries++;
      if (retries === maxRetries) {
        throw new Error(`Failed to write port status file after ${maxRetries} attempts`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Enhanced startPortStatusCheck function
function startPortStatusCheck(port: number, health: PortStatus['health']) {
  if (portStatusInterval) {
    clearInterval(portStatusInterval);
  }

  debugWorkflow('PortStatus', 'Starting periodic status check', { port, health });

  // Check every 5 seconds
  portStatusInterval = setInterval(async () => {
    try {
      // First try to read the existing file
      let needsUpdate = false;
      try {
        const content = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8');
        const status = JSON.parse(content) as PortStatus;
        debugWorkflow('PortStatus', 'Current status:', status);

        // Check if the file is stale or has incorrect information
        if (status.pid !== process.pid ||
            status.port !== port ||
            status.workflow !== getWorkflowName() ||
            Date.now() - new Date(status.timestamp).getTime() > 30000) {
          debugWorkflow('PortStatus', 'Status needs update', {
            currentPid: process.pid,
            statusPid: status.pid,
            currentPort: port,
            statusPort: status.port,
            currentWorkflow: getWorkflowName(),
            statusWorkflow: status.workflow,
            age: Date.now() - new Date(status.timestamp).getTime()
          });
          needsUpdate = true;
        }
      } catch (err) {
        // File doesn't exist or is corrupted
        debugWorkflow('PortStatus', 'Status file error:', err);
        needsUpdate = true;
      }

      if (needsUpdate) {
        debugWorkflow('PortStatus', 'Refreshing port status file');
        await writePortStatus(port, true, health);
      }
    } catch (error) {
      console.error('[PortStatus] Error during periodic check:', error);
    }
  }, 5000);
}

// Add startup logging
console.log('\n=== Server Initialization Starting ===');
console.log('Process Info:', {
  pid: process.pid,
  ppid: process.ppid,
  cwd: process.cwd(),
  argv: process.argv
});

// Early environment logging with defaults
const NODE_ENV = process.env.NODE_ENV || 'development';
const WORKFLOW_NAME = process.env.REPL_WORKFLOW_NAME || 'Dev';
console.log('[Server] Environment:', {
  NODE_ENV,
  WORKFLOW_NAME,
  REPL_SLUG: process.env.REPL_SLUG,
  npm_lifecycle_event: process.env.npm_lifecycle_event,
  DEBUG,
  PORT: process.env.PORT
});

// Add process event handlers early with more informative logging
process.on('SIGHUP', () => {
  console.log('[Server] Received SIGHUP signal, attempting graceful shutdown...');
  console.log('[Server] Current process state:', {
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
  cleanup().then(() => {
    console.log('[Server] Cleanup complete after SIGHUP');
    process.exit(0);
  }).catch(error => {
    console.error('[Server] Error during cleanup after SIGHUP:', error);
    process.exit(1);
  });
});

process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught exception:', error);
  cleanup().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason);
  cleanup().finally(() => process.exit(1));
});

// Cleanup function to handle graceful shutdown
async function cleanup() {
  try {
    await cleanupPortStatus();
    await releaseInstanceLock();
    console.log('[Server] Cleanup completed successfully');
  } catch (error) {
    console.error('[Server] Error during cleanup:', error);
    throw error;
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

async function cleanupStaleFiles() {
  console.log('[Server] Checking for and cleaning up stale workflow files...');

  try {
    // Check instance lock
    let instanceLock = null;
    try {
      const lockContent = await fs.promises.readFile(INSTANCE_LOCK_FILE, 'utf-8');
      instanceLock = JSON.parse(lockContent);
      console.log('[Server] Found instance lock:', instanceLock);

      try {
        process.kill(instanceLock.pid, 0);
        console.log('[Server] Process from instance lock is still running');
      } catch (e) {
        console.log('[Server] Found stale instance lock, removing');
        await fs.promises.unlink(INSTANCE_LOCK_FILE);
      }
    } catch (e) {
      console.log('[Server] No instance lock found or error reading it');
    }

    // Check port status
    let portStatus = null;
    try {
      const statusContent = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8');
      portStatus = JSON.parse(statusContent);
      console.log('[Server] Found port status:', portStatus);

      try {
        process.kill(portStatus.pid, 0);
        console.log('[Server] Process from port status is still running');
      } catch (e) {
        console.log('[Server] Found stale port status, removing');
        await fs.promises.unlink(PORT_STATUS_FILE);
      }
    } catch (e) {
      console.log('[Server] No port status found or error reading it');
    }
  } catch (error) {
    console.error('[Server] Error during stale file cleanup:', error);
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
    console.log('\n=== Server Startup Sequence ===');
    console.log('[Server] Checking for existing workflow instances...');

    // Clean up any stale files first
    await cleanupStaleFiles();

    // Check .port-status first
    let existingStatus = null;
    try {
      const statusContent = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8');
      existingStatus = JSON.parse(statusContent);
      console.log('[Server] Found existing port status:', {
        port: existingStatus.port,
        pid: existingStatus.pid,
        workflow: existingStatus.workflow,
        health: existingStatus.health
      });

      // Verify if the process is actually running and responding
      try {
        process.kill(existingStatus.pid, 0);
        const response = await fetch(`http://${HOST}:${existingStatus.port}/api/health`);
        if (response.ok) {
          console.log('[Server] Found healthy running workflow instance - exiting');
          process.exit(0);
        }
      } catch (e) {
        console.log('[Server] Existing workflow not responding, proceeding with startup');
      }
    } catch (e) {
      console.log('[Server] No existing port status found');
    }

    const canStart = await acquireInstanceLock();
    if (!canStart) {
      console.log('[Server] Detected running Dev workflow instance - exiting');
      process.exit(0);
    }

    console.log('[Server] Starting server...');

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
    console.log(`[Server] Server is fully initialized and ready on port ${serverPort}`);

    await writePortStatus(serverPort, true, {
      database: !!dbConnected,
      server: true,
      vite: viteSetupComplete
    });

    // Start periodic status check
    startPortStatusCheck(serverPort, {
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

// Add these routes after the /api/health endpoint
app.get('/api/diagnostic', async (req, res) => {
  try {
    // Read instance lock file
    let instanceLock = null;
    try {
      const lockContent = await fs.promises.readFile(INSTANCE_LOCK_FILE, 'utf-8');
      instanceLock = JSON.parse(lockContent);
    } catch (e) {
      console.log('[Server] No instance lock file found');
    }

    // Read port status file
    let portStatus = null;
    try {
      const statusContent = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8');
      portStatus = JSON.parse(statusContent);
    } catch (e) {
      console.log('[Server] No port status file found');
    }

    res.json({
      current_process: {
        pid: process.pid,
        uptime: process.uptime(),
        env: {
          NODE_ENV: process.env.NODE_ENV,
          WORKFLOW_NAME: process.env.REPL_WORKFLOW_NAME,
          npm_lifecycle_event: process.env.npm_lifecycle_event,
          REPL_SLUG: process.env.REPL_SLUG
        }
      },
      detected_workflow: getWorkflowName(),
      instance_lock: instanceLock,
      port_status: portStatus,
      server_port: serverPort,
      is_ready: isServerReady
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get diagnostic data' });
  }
});

// Enhance health endpoint to include workflow info
app.get('/api/health', async (req, res) => {
  debugWorkflow('Health', 'Health check requested', {
    port: serverPort,
    workflow: getWorkflowName(),
    environment: process.env.NODE_ENV
  });

  try {
    const dbStart = Date.now();
    await testConnection();
    const dbDuration = Date.now() - dbStart;

    // Read lock and status files
    let instanceLock = null;
    let portStatus = null;
    try {
      instanceLock = JSON.parse(await fs.promises.readFile(INSTANCE_LOCK_FILE, 'utf-8'));
      portStatus = JSON.parse(await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8'));
    } catch (e) {
      debugWorkflow('Health', 'Could not read coordination files', e);
    }

    const status = {
      status: 'healthy',
      port: serverPort,
      ready: isServerReady,
      mode: process.env.NODE_ENV,
      workflow: getWorkflowName(),
      timestamp: new Date().toISOString(),
      coordination: {
        instance_lock: instanceLock,
        port_status: portStatus
      },
      diagnostics: {
        database_response_time: `${dbDuration}ms`,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      }
    };

    debugWorkflow('Health', 'Health check successful', status);
    res.json(status);
  } catch (error) {
    debugWorkflow('Health', 'Health check failed', { error });
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
  console.log('[Server] Running in production mode');
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

    if (portStatusInterval) {
      clearInterval(portStatusInterval);
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

      console.log('[Server] All active requestscompleted');
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

// Update signal handlers with proper promise handling
process.on('SIGTERM', () => {
  console.log('[Server] Received SIGTERM signal');
  const forceShutdownTimeout = setTimeout(() => {
    console.error('[Server] Forced shutdown due to timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  shutdown()
    .catch(error => {
      console.error('[Server] Error during shutdown:', error);
    })
    .finally(() => {
      clearTimeout(forceShutdownTimeout);
      process.exit(0);
    });
});

process.on('SIGINT', () => {
  console.log('[Server] Received SIGINT signal');
  const forceShutdownTimeout = setTimeout(() => {
    console.error('[Server] Forced shutdown due to timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  shutdown()
    .catch(error => {
      console.error('[Server] Error during shutdown:', error);
    })
    .finally(() => {
      clearTimeout(forceShutdownTimeout);
      process.exit(0);    });
});

// Final startup logging
console.log('[Server] Will attempt to bind to ports in range:', {
  preferredPort,
  availablePorts: '5001-5010',
  NODE_ENV: process.env.NODE_ENV
});

console.log('[Server] Starting server initialization...');

// Update the acquireInstanceLock function to be more verbose and handle concurrent setup
async function acquireInstanceLock(): Promise<boolean> {
  const currentWorkflow = getWorkflowName();

  try {
    const lockData = {
      pid: process.pid,
      timestamp: new Date().toISOString(),
      workflow: currentWorkflow,
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        npm_lifecycle_event: process.env.npm_lifecycle_event,
        concurrent: process.env.npm_lifecycle_event === 'npx'
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

        // Handle concurrent setup - if the existing lock is from the same workflow
        // but running via concurrent (npx), consider it the same workflow
        if (existing.workflow === currentWorkflow ||
            (existing.environment?.concurrent && currentWorkflow === 'Dev')) {
          try {
            process.kill(existing.pid, 0);
            debugLog('Instance', 'Found running instance of same workflow', existing);
            console.log('[Server] Found existing Dev workflow instance:', {
              pid: existing.pid,
              workflow: existing.workflow,
              concurrent: existing.environment?.concurrent
            });
            return false;
          } catch {
            debugLog('Instance', 'Found stale lock, cleaning up', existing);
            await fs.promises.unlink(INSTANCE_LOCK_FILE);
            return acquireInstanceLock();
          }
        }

        debugLog('Instance', 'Lock belongs to different workflow, allowing concurrent execution', {
          current: currentWorkflow,
          existing: existing.workflow
        });
        return true;
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