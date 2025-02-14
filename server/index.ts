import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic } from "./vite.js";
import { testConnection } from "./db.js";
import { createServer } from 'http';
import { AddressInfo } from 'net';

const app = express();
const BASE_PORT = parseInt(process.env.PORT || "5000", 10);
const PORT_RANGE = 10; // Try ports 5000-5009
let serverInstance: ReturnType<typeof createServer.prototype.listen> | null = null;
let isShuttingDown = false;
let viteSetupComplete = false;
let viteSetupPromise: Promise<void> | null = null;

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Enhanced request logging for debugging
app.use((req, res, next) => {
  if (isShuttingDown) {
    res.status(503).json({ error: 'Server is shutting down' });
    return;
  }

  const start = Date.now();
  const requestId = Math.random().toString(36).substring(7);

  console.log(`[${requestId}] ${req.method} ${req.originalUrl}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`[${requestId}] Request body:`, JSON.stringify(req.body, null, 2));
  }

  // Add response logging
  const oldJson = res.json;
  res.json = function (body) {
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

// Track active connections with enhanced logging
const connections = new Set<any>();
server.on('connection', (conn) => {
  console.log('[Server] New connection established');
  connections.add(conn);

  conn.on('error', (err) => {
    console.warn('[Server] Connection error:', err);
  });

  conn.on('close', () => {
    console.log('[Server] Connection closed');
    connections.delete(conn);
  });
});

// Enhanced WebSocket upgrade handling
const wsConnections = new Set<any>();
server.on('upgrade', (req, socket, head) => {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[WebSocket ${requestId}] Upgrade request received`);

  socket.on('error', (err) => {
    console.warn(`[WebSocket ${requestId}] Socket error:`, err);
    socket.destroy();
  });

  socket.on('close', () => {
    console.log(`[WebSocket ${requestId}] Socket closed`);
    wsConnections.delete(socket);
  });

  wsConnections.add(socket);
});

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

  // Synchronize Vite setup with a Promise
  const setupViteOnce = async () => {
    if (!viteSetupPromise) {
      viteSetupPromise = (async () => {
        try {
          await setupVite(app, server);
          viteSetupComplete = true;
          console.log('[Server] Vite middleware setup completed');
        } catch (error) {
          console.error('[Server] Vite setup failed:', error);
          viteSetupPromise = null; // Allow retry on failure
          throw error;
        }
      })();
    }
    return viteSetupPromise;
  };

  // Middleware to ensure Vite is setup before handling requests
  app.use(async (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }

    try {
      if (!viteSetupComplete) {
        await setupViteOnce();
      }
      next();
    } catch (e) {
      console.error('[Server] Error in Vite middleware:', e);
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

// Initialize server with port range support
async function initializeServer() {
  try {
    console.log('[Server] Starting initialization');

    // Test database connection
    console.log('[Server] Testing database connection...');
    await testConnection();
    console.log('[Server] Database connection successful');

    // Try ports in range until one works
    for (let portOffset = 0; portOffset < PORT_RANGE; portOffset++) {
      const currentPort = BASE_PORT + portOffset;
      try {
        await new Promise<void>((resolve, reject) => {
          console.log(`[Server] Attempting to bind to port ${currentPort}...`);

          const onError = (err: Error & { code?: string }) => {
            server.removeListener('listening', onListening);
            if (err.code === 'EADDRINUSE') {
              console.log(`[Server] Port ${currentPort} is in use, trying next port...`);
              resolve(); // Continue to next port
            } else {
              console.error(`[Server] Error binding to port ${currentPort}:`, err);
              reject(err);
            }
          };

          const onListening = () => {
            server.removeListener('error', onError);
            const addr = server.address() as AddressInfo;
            console.log(`[Server] Successfully bound to 0.0.0.0:${addr.port}`);
            process.env.PORT = addr.port.toString(); // Update PORT for other parts of the application
            resolve();
          };

          server.once('error', onError);
          server.once('listening', onListening);
          serverInstance = server.listen(currentPort, '0.0.0.0');
        });

        if (serverInstance?.listening) {
          console.log('[Server] Application fully initialized and ready for requests');
          return; // Successfully bound to a port
        }
      } catch (error) {
        if (portOffset === PORT_RANGE - 1) {
          throw new Error(`Failed to bind to any port in range ${BASE_PORT}-${BASE_PORT + PORT_RANGE - 1}`);
        }
      }
    }
  } catch (error) {
    console.error('[Server] Fatal error during initialization:', error);
    process.exit(1);
  }
}

// Enhanced cleanup handlers
async function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('[Server] Starting graceful shutdown...');

  // Close all WebSocket connections first
  const wsClosePromises = Array.from(wsConnections).map((socket) => {
    return new Promise<void>((resolve) => {
      socket.destroy();
      wsConnections.delete(socket);
      resolve();
    });
  });

  await Promise.all(wsClosePromises);

  // Close all existing connections with timeout
  const closePromises = Array.from(connections).map((conn) => {
    return new Promise<void>((resolve) => {
      conn.end();
      conn.once('close', () => {
        connections.delete(conn);
        resolve();
      });

      // Force close after timeout
      setTimeout(() => {
        if (connections.has(conn)) {
          console.warn('[Server] Force closing connection after timeout');
          conn.destroy();
          connections.delete(conn);
          resolve();
        }
      }, 2000);
    });
  });

  try {
    // Wait for all connections to close with a timeout
    await Promise.race([
      Promise.all(closePromises),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection cleanup timeout')), 5000))
    ]);
  } catch (error) {
    console.warn('[Server] Connection cleanup timed out:', error);
  }

  if (serverInstance) {
    try {
      await new Promise((resolve, reject) => {
        serverInstance!.close((err?: Error) => {
          if (err) {
            console.error('[Server] Error during shutdown:', err);
            reject(err);
          } else {
            console.log('[Server] HTTP server closed successfully');
            resolve(true);
          }
        });

        // Set a timeout for forceful shutdown
        setTimeout(() => {
          console.error('[Server] Graceful shutdown timed out after 5s, forcing exit');
          process.exit(1);
        }, 5000);

        // Stop accepting new connections
        serverInstance!.unref();
      });
    } catch (error) {
      console.error('[Server] Error during cleanup:', error);
      process.exit(1);
    }
  }

  process.exit(0);
}

// Register cleanup handlers
process.on('SIGTERM', () => {
  console.log('[Server] Received SIGTERM signal');
  cleanup();
});

process.on('SIGINT', () => {
  console.log('[Server] Received SIGINT signal');
  cleanup();
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  cleanup();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
  cleanup();
});

// Start the server
initializeServer().catch((error) => {
  console.error('[Server] Unhandled error during startup:', error);
  process.exit(1);
});