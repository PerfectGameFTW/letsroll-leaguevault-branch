import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();

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

(async () => {
  // API routes first - ensures all API endpoints return JSON
  app.use('/api', (req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    next();
  });

  // Register routes (includes payment deletion endpoints)
  const server = registerRoutes(app);

  // Global API error handler
  app.use('/api', (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('[API Error]', err);
    res.status(err.status || 500).json({
      success: false,
      error: {
        message: err.message || "Internal Server Error"
      }
    });
  });

  // Frontend handling
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Start server
  const PORT = 5000;
  server.listen(PORT, "0.0.0.0", () => {
    log(`Server running on port ${PORT}`);
  });
})();