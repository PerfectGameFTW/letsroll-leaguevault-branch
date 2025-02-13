import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { testConnection } from "./db";

const app = express();

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
  res.json = function(body) {
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
  app.use(async (req, res, next) => {
    // Skip Vite for API routes
    if (req.path.startsWith('/api/')) {
      return next();
    }
    try {
      await setupVite(app, server);
      next();
    } catch (e) {
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

// Initialize server
async function initializeServer() {
  try {
    console.log('[Server] Starting initialization...');

    // Test database connection
    console.log('[Server] Testing database connection...');
    await testConnection();
    console.log('[Server] Database connection successful');

    // Start server with port handling
    const startServer = async (initialPort: number = 5000): Promise<void> => {
      for (let port = initialPort; port < initialPort + 10; port++) {
        try {
          await new Promise<void>((resolve, reject) => {
            const onError = (err: Error) => {
              server.removeListener('listening', onListening);
              reject(err);
            };
            const onListening = () => {
              server.removeListener('error', onError);
              console.log(`[Server] Ready and listening on port ${port}`);
              if (process.send) {
                process.send('ready');
              }
              resolve();
            };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(port, '0.0.0.0');
          });
          return;
        } catch (err: any) {
          if (err.code === 'EADDRINUSE') {
            console.log(`[Server] Port ${port} in use, trying next port...`);
            continue;
          }
          throw err;
        }
      }
      throw new Error('Unable to find an available port after multiple attempts');
    };

    await startServer();
    console.log('[Server] Application fully initialized and ready for requests');
  } catch (error) {
    console.error('[Server] Fatal error during initialization:', error);
    process.exit(1);
  }
}

// Start the server
initializeServer().catch((error) => {
  console.error('[Server] Unhandled error during startup:', error);
  process.exit(1);
});