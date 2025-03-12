import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, Router } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser, insertUserSchema } from "@shared/schema";
import { z } from "zod";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

const PostgresSessionStore = connectPg(session);

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  try {
    const [hashed, salt] = stored.split(".");
    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;

    // Add debug logging
    console.log('[Auth Debug] Password comparison:', {
      suppliedLength: suppliedBuf.length,
      storedLength: hashedBuf.length,
      salt,
      match: timingSafeEqual(hashedBuf, suppliedBuf)
    });

    return timingSafeEqual(hashedBuf, suppliedBuf);
  } catch (error) {
    console.error('[Auth] Error comparing passwords:', error);
    return false;
  }
}

// Validate user object has required fields
function isValidUser(user: any): user is SelectUser {
  return (
    user &&
    typeof user === 'object' &&
    typeof user.id === 'number' &&
    typeof user.email === 'string' &&
    typeof user.password === 'string' &&
    typeof user.name === 'string' &&
    typeof user.isAdmin === 'boolean' &&
    user.createdAt instanceof Date
  );
}

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: new PostgresSessionStore({
      pool,
      createTableIfMissing: true,
      pruneSessionInterval: 60,
      tableName: 'session'
    }),
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true
    }
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy({
      usernameField: 'email',
      passwordField: 'password'
    }, async (email: string, password: string, done) => {
      try {
        console.log(`[Auth Debug] Login attempt:`, {
          email,
          hasPassword: !!password,
          timestamp: new Date().toISOString()
        });

        const user = await storage.getUserByEmail(email);

        if (!user) {
          console.log(`[Auth Debug] No user found with email: ${email}`);
          return done(null, false, { message: "Invalid email or password" });
        }

        if (!isValidUser(user)) {
          console.error('[Auth Debug] Invalid user object structure:', user);
          return done(null, false, { message: "Invalid user data structure" });
        }

        const isValidPassword = await comparePasswords(password, user.password);
        console.log(`[Auth Debug] Password validation:`, {
          userId: user.id,
          isValid: isValidPassword,
          timestamp: new Date().toISOString()
        });

        if (!isValidPassword) {
          console.log(`[Auth Debug] Invalid password for email: ${email}`);
          return done(null, false, { message: "Invalid email or password" });
        }

        console.log(`[Auth Debug] Login successful for user ID: ${user.id}`);
        return done(null, user);
      } catch (error) {
        console.error('[Auth Debug] Login error:', error);
        return done(error);
      }
    }),
  );

  passport.serializeUser((user, done) => {
    if (!isValidUser(user)) {
      return done(new Error('Invalid user object during serialization'));
    }
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        console.log(`[Auth] No user found for ID: ${id}, clearing session`);
        return done(null, null);
      }

      if (!isValidUser(user)) {
        console.error(`[Auth] Invalid user object for ID: ${id}`, user);
        return done(null, null);
      }

      console.log(`[Auth] Successfully deserialized user ID: ${id}`);
      done(null, user);
    } catch (error) {
      console.error('[Auth] Deserialization error:', error);
      done(error);
    }
  });

  // Auth routes - ensure these are mounted before any other routes
  const authRouter = Router();

  authRouter.post("/register", async (req, res) => {
    try {
      console.log('[Auth] Processing registration request:', { 
        email: req.body.email,
        hasPassword: !!req.body.password,
        validation: 'starting'
      });

      const registrationData = {
        email: req.body.email,
        password: req.body.password,
        name: req.body.name,
        phone: req.body.phone,
      };

      console.log('[Auth] Validating registration data');
      const result = insertUserSchema.safeParse(registrationData);

      if (!result.success) {
        console.log('[Auth] Validation errors:', result.error.errors);
        const validationErrors = result.error.errors.map(error => ({
          field: error.path.join('.'),
          message: error.message
        }));

        return res.status(400).json({
          success: false,
          error: {
            message: "Registration validation failed",
            details: validationErrors
          }
        });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(result.data.email);
      if (existingUser) {
        console.log(`[Auth] Registration failed - email already exists: ${result.data.email}`);
        return res.status(400).json({
          success: false,
          error: { message: "Email already registered" }
        });
      }

      // Hash password and create user
      const hashedPassword = await hashPassword(result.data.password);
      console.log('[Auth] Creating user with validated data');

      const user = await storage.createUser({
        ...result.data,
        password: hashedPassword,
        isAdmin: false, // Ensure new users are not admins by default
      });

      console.log(`[Auth] User registered successfully, ID: ${user.id}`);

      // Log the user in after registration
      req.login(user, (err) => {
        if (err) {
          console.error('[Auth] Login after registration failed:', err);
          return res.status(500).json({
            success: false,
            error: { message: "Failed to login after registration" }
          });
        }
        res.status(201).json({
          success: true,
          data: { ...user, password: undefined }
        });
      });
    } catch (error) {
      console.error('[Auth] Registration error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: { 
            message: "Validation failed",
            details: error.errors.map(err => ({
              field: err.path.join('.'),
              message: err.message
            }))
          }
        });
      }
      res.status(500).json({
        success: false,
        error: { 
          message: error instanceof Error ? error.message : "Failed to register user"
        }
      });
    }
  });

  authRouter.post("/login", (req, res, next) => {
    console.log('[Auth] Login request received:', {
      email: req.body.email,
      hasPassword: !!req.body.password
    });

    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        console.error('[Auth] Login error:', err);
        return res.status(500).json({
          success: false,
          error: { message: "Internal server error" }
        });
      }
      if (!user) {
        console.log('[Auth] Login failed:', info?.message);
        return res.status(401).json({
          success: false,
          error: { message: info?.message || "Invalid credentials" }
        });
      }
      req.login(user, (err) => {
        if (err) {
          console.error('[Auth] Session creation error:', err);
          return res.status(500).json({
            success: false,
            error: { message: "Failed to create session" }
          });
        }
        console.log(`[Auth] Login successful for user ID: ${user.id}`);
        res.json({
          success: true,
          data: { ...user, password: undefined }
        });
      });
    })(req, res, next);
  });

  authRouter.post("/logout", (req, res, next) => {
    if (req.user) {
      console.log(`[Auth] Logging out user ID: ${(req.user as SelectUser).id}`);
    }
    req.logout((err) => {
      if (err) {
        console.error('[Auth] Logout error:', err);
        return next(err);
      }
      console.log('[Auth] Logout successful');
      res.json({ success: true });
    });
  });

  authRouter.get("/user", (req, res) => {
    try {
      console.log('[Auth] /api/user request:', { 
        isAuthenticated: req.isAuthenticated(),
        hasSession: !!req.session,
        sessionID: req.sessionID,
      });

      if (!req.isAuthenticated()) {
        console.log('[Auth] User not authenticated');
        return res.status(401).json({
          success: false,
          error: { 
            message: "Not authenticated",
            code: "AUTH_REQUIRED"
          }
        });
      }

      if (!req.user) {
        console.log('[Auth] No user object in authenticated session');
        return res.status(401).json({
          success: false,
          error: { 
            message: "Session invalid",
            code: "INVALID_SESSION"
          }
        });
      }

      const user = req.user as SelectUser;
      console.log(`[Auth] Successfully retrieved user data for ID: ${user.id}`);
      res.json({
        success: true,
        data: { ...user, password: undefined }
      });
    } catch (error) {
      console.error('[Auth] Error in /api/user route:', error);
      res.status(500).json({
        success: false,
        error: { 
          message: "Internal server error",
          code: "SERVER_ERROR",
          details: error instanceof Error ? error.message : undefined
        }
      });
    }
  });

  // Mount auth routes before any other routes
  app.use('/api', authRouter);
}