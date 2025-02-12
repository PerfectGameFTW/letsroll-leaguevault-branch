import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { testConnection } from "./db";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5000;

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Request logging with more detailed information
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[${requestId}][${req.method}] ${req.originalUrl}`);

  // Add response logging
  const oldJson = res.json;
  res.json = function(body) {
    console.log(`[${requestId}] Response body:`, JSON.stringify(body));
    return oldJson.call(this, body);
  };

  res.on('finish', () => {
    console.log(`[${requestId}][${req.method}] ${req.originalUrl} ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// API-specific middleware
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Health check endpoint with more detailed status
app.get('/api/health', async (req, res) => {
  try {
    await testConnection();
    res.json({
      success: true,
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      port: PORT
    });
  } catch (error) {
    console.error('[Health Check] Database connection failed:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Initialize server with proper startup sequence
async function initializeServer() {
  try {
    console.log('[Server] Starting initialization...');

    // Test database connection first
    console.log('[Server] Testing database connection...');
    await testConnection();
    console.log('[Server] Database connection successful');

    // Register API routes
    console.log('[Server] Registering API routes...');
    const server = registerRoutes(app);

    // Global API error handler
    app.use('/api', (err: any, req: Request, res: Response, next: NextFunction) => {
      console.error('[API Error]', err);
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
    });

    // Frontend handling
    if (app.get("env") === "development") {
      app.use((req, res, next) => {
        if (req.path.startsWith('/api')) {
          return next('route');
        }
        next();
      });

      await setupVite(app, server);
    } else {
      app.use((req, res, next) => {
        if (req.path.startsWith('/api')) {
          return next('route');
        }
        next();
      });
      serveStatic(app);
    }

    // Start server with health check
    await new Promise<void>((resolve, reject) => {
      server.listen(PORT, "0.0.0.0", () => {
        console.log(`[Server] Ready and listening on port ${PORT}`);
        resolve();
      }).on('error', (error: any) => {
        console.error('[Server] Failed to start server:', error);
        reject(error);
      });

      // Add timeout for startup
      setTimeout(() => {
        reject(new Error('Server startup timeout after 30 seconds'));
      }, 30000);
    });

    console.log('[Server] Initialization complete');

    return server;
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