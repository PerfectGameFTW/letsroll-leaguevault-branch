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

  if (req.method === 'POST' && req.path.startsWith('/api/payments')) {
    console.log(`[${requestId}] Payment request body:`, JSON.stringify(req.body, null, 2));
  }

  // Add response logging
  const oldJson = res.json;
  res.json = function(body) {
    if (req.path.startsWith('/api/payments')) {
      console.log(`[${requestId}] Payment response body:`, JSON.stringify(body));
    } else {
      console.log(`[${requestId}] Response body:`, JSON.stringify(body));
    }
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

// Health check endpoint with port readiness indicator
app.get('/api/health', async (req, res) => {
  try {
    await testConnection();
    // Add a ready flag to indicate the server is fully initialized
    const ready = true;
    res.json({
      success: true,
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      port: PORT,
      ready
    });
  } catch (error) {
    console.error('[Health Check] Database connection failed:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      ready: false
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
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // Start server with explicit ready signal and port binding
    return new Promise<void>((resolve, reject) => {
      const serverInstance = server.listen(PORT, "0.0.0.0", () => {
        console.log(`[Server] Ready and listening on port ${PORT}`);
        console.log('[Server] Application fully initialized and ready for testing');
        resolve();
      });

      serverInstance.on('error', (error: any) => {
        console.error('[Server] Failed to start server:', error);
        reject(error);
      });

      // Add timeout for startup
      setTimeout(() => {
        reject(new Error('Server startup timeout after 30 seconds'));
      }, 30000);
    });
  } catch (error) {
    console.error('[Server] Fatal error during initialization:', error);
    process.exit(1);
  }
}

// Start the server with error handling
initializeServer().catch((error) => {
  console.error('[Server] Unhandled error during startup:', error);
  process.exit(1);
});