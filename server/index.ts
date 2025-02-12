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

// Ensure JSON responses for all API routes
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

(async () => {
  // Register routes (includes payment deletion endpoints)
  const server = registerRoutes(app);

  // Global API error handler - ensure JSON responses even for errors
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