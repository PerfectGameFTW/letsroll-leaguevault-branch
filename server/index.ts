import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();

// Early request logging middleware
app.use((req, res, next) => {
  console.log(`[EARLY-MIDDLEWARE] Incoming ${req.method} request to ${req.originalUrl}`);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[express] Incoming ${req.method} request to ${req.originalUrl}`);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[express] ${req.method} ${req.originalUrl} ${res.statusCode} in ${duration}ms`);
  });
  
  next();
});

(async () => {
  const server = registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Register API routes before Vite middleware
  app.use('/api', (req, res, next) => {
    console.log('[API Router] Request:', req.method, req.path);
    next();
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client
  const PORT = 5000;
  server.listen(PORT, "0.0.0.0", () => {
    log(`serving on port ${PORT}`);
  });
})();
