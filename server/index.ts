import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic } from "./vite.js";
import { testConnection } from "./db.js";
import { createServer } from 'http';

const app = express();
const PORT = process.env.PORT || 5000;
let serverInstance: ReturnType<typeof server.listen> | null = null;

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Enhanced request logging for debugging
app.use((req, res, next) => {
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
      next(e);
    }
  });
  
  // Add CORS headers for development
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
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

// Initialize server
async function initializeServer() {
  try {
    console.log('[Server] Starting initialization on port', PORT);

    // Test database connection
    console.log('[Server] Testing database connection...');
    await testConnection();
    console.log('[Server] Database connection successful');

    // Start server with explicit host binding and port recovery
    await new Promise<void>((resolve, reject) => {
      const startServer = () => {
        const onError = (err: Error & { code?: string }) => {
          server.removeListener('listening', onListening);
          if (err.code === 'EADDRINUSE') {
            console.log('[Server] Port in use, retrying in 3 seconds...');
            setTimeout(() => {
              if (serverInstance) {
                serverInstance.close();
              }
              serverInstance = server.listen(PORT);
              serverInstance.once('error', onError);
              serverInstance.once('listening', onListening);
            }, 3000);
          } else {
            console.error('[Server] Failed to start:', err);
            reject(err);
          }
        };

        const onListening = () => {
          server.removeListener('error', onError);
          const addr = server.address();
          console.log(`[Server] Ready and listening on ${typeof addr === 'string' ? addr : `port ${addr?.port}`}`);
          resolve();
        };

        server.once('error', onError);
        server.once('listening', onListening);
        serverInstance = server.listen(PORT);
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
function cleanup() {
  console.log('[Server] Cleaning up...');
  if (serverInstance) {
    serverInstance.close(() => {
      console.log('[Server] Server closed');
      process.exit(0);
    });

    // Force close after 3 seconds if graceful shutdown fails
    setTimeout(() => {
      console.log('[Server] Forcing exit after timeout');
      process.exit(1);
    }, 3000);
  } else {
    process.exit(0);
  }
}

// Register cleanup handlers
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  cleanup();
});

// Start the server
initializeServer().catch((error) => {
  console.error('[Server] Unhandled error during startup:', error);
  process.exit(1);
});
