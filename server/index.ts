import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { testConnection } from "./db";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5000;

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${req.method}] ${req.originalUrl}`);
  res.on('finish', () => {
    console.log(`[${req.method}] ${req.originalUrl} ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// API-specific middleware
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await testConnection();
    res.json({
      success: true,
      status: 'healthy',
      database: 'connected'
    });
  } catch (error) {
    console.error('[Health Check] Database connection failed:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

(async () => {
  try {
    // Register API routes first
    const server = registerRoutes(app);

    // Global API error handler
    app.use('/api', (err: any, req: Request, res: Response, next: NextFunction) => {
      console.error('[API Error]', err);
      if (!res.headersSent) {
        res.status(err.status || 500).json({
          success: false,
          error: {
            message: err.message || "Internal Server Error"
          }
        });
      }
    });

    // Frontend handling after API routes
    if (app.get("env") === "development") {
      // Skip Vite for API routes
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

    // Start server with proper error handling
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[Server] Ready and listening on port ${PORT}`);
    }).on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${PORT} is already in use`);
      } else {
        console.error('[Server] Failed to start server:', error);
      }
      process.exit(1);
    });

  } catch (error) {
    console.error('[Server] Fatal error during startup:', error);
    process.exit(1);
  }
})();