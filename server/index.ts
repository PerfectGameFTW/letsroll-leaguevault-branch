import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic } from "./vite.js";
import { testConnection } from "./db.js";
import { createServer } from 'http';
import { AddressInfo } from 'net';

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);
let serverInstance: ReturnType<typeof createServer.prototype.listen> | null = null;
let isShuttingDown = false;

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

// Track active connections
const connections = new Set<any>();
server.on('connection', (conn) => {
  console.log('[Server] New connection established');
  connections.add(conn);
  conn.on('close', () => {
    console.log('[Server] Connection closed');
    connections.delete(conn);
  });
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
      console.error('[Server] Error setting up Vite:', e);
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

// Initialize server with retries and port checking
async function initializeServer() {
  try {
    console.log('[Server] Starting initialization on port', PORT);

    // Test database connection
    console.log('[Server] Testing database connection...');
    await testConnection();
    console.log('[Server] Database connection successful');

    // Start server with explicit host binding and port recovery
    await new Promise<void>((resolve, reject) => {
      const maxRetries = 5;
      let retryCount = 0;

      const startServer = () => {
        try {
          const onError = (err: Error & { code?: string }) => {
            server.removeListener('listening', onListening);

            if (err.code === 'EADDRINUSE') {
              if (retryCount < maxRetries) {
                retryCount++;
                console.log(`[Server] Port ${PORT} in use, retry attempt ${retryCount}/${maxRetries} in 3 seconds...`);
                setTimeout(() => {
                  if (serverInstance) {
                    serverInstance.close();
                  }
                  serverInstance = server.listen(PORT, '0.0.0.0');
                  serverInstance.once('error', onError);
                  serverInstance.once('listening', onListening);
                }, 3000);
              } else {
                console.error(`[Server] Failed to bind to port ${PORT} after ${maxRetries} attempts`);
                reject(new Error(`Could not bind to port ${PORT} after ${maxRetries} attempts`));
              }
            } else {
              console.error('[Server] Fatal error during startup:', err);
              reject(err);
            }
          };

          const onListening = () => {
            server.removeListener('error', onError);
            const addr = server.address() as AddressInfo;
            console.log(`[Server] Successfully bound to 0.0.0.0:${addr.port}`);
            console.log('[Server] Active connections:', connections.size);
            resolve();
          };

          server.once('error', onError);
          server.once('listening', onListening);
          serverInstance = server.listen(PORT, '0.0.0.0');
        } catch (error) {
          console.error('[Server] Error in startServer:', error);
          reject(error);
        }
      };

      startServer();
    });

    console.log('[Server] Application fully initialized and ready for requests');
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

  // Close all existing connections
  connections.forEach((conn) => {
    conn.end();
    connections.delete(conn);
  });

  if (serverInstance) {
    try {
      await new Promise((resolve, reject) => {
        serverInstance!.close((err) => {
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