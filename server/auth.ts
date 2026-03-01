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

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  try {
    const [hashed, salt] = stored.split(".");
    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
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
    secret: process.env.SESSION_SECRET || '',
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
        const user = await storage.getUserByEmail(email);

        if (!user) {
          return done(null, false, { message: "Invalid email or password" });
        }

        if (!isValidUser(user)) {
          console.error('[Auth] Invalid user object structure for ID:', user?.id);
          return done(null, false, { message: "Invalid user data structure" });
        }

        const isValidPassword = await comparePasswords(password, user.password);

        if (!isValidPassword) {
          return done(null, false, { message: "Invalid email or password" });
        }

        return done(null, user);
      } catch (error) {
        console.error('[Auth] Login error:', error);
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
      if (!user || !isValidUser(user)) {
        return done(null, null);
      }
      done(null, user);
    } catch (error) {
      console.error('[Auth] Deserialization error:', error);
      done(error);
    }
  });

  // Auth routes - ensure these are mounted before any other routes
  const authRouter = Router();

  // Register auth endpoints
  authRouter.post("/register", async (req, res) => {
    try {
      const registrationData = {
        email: req.body.email,
        password: req.body.password,
        name: req.body.name,
        phone: req.body.phone,
      };

      const result = insertUserSchema.safeParse(registrationData);

      if (!result.success) {
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

      const existingUser = await storage.getUserByEmail(result.data.email);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: { message: "Email already registered" }
        });
      }

      const hashedPassword = await hashPassword(result.data.password);

      const user = await storage.createUser({
        ...result.data,
        password: hashedPassword,
        isAdmin: false,
      });

      // Log the user in after registration
      req.login(user, (err) => {
        if (err) {
          console.error('[Auth] Session creation after registration failed:', err);
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
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        console.error('[Auth] Login error:', err);
        return res.status(500).json({
          success: false,
          error: { message: "Internal server error" }
        });
      }
      if (!user) {
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
        res.json({
          success: true,
          data: { ...user, password: undefined }
        });
      });
    })(req, res, next);
  });

  authRouter.post("/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) {
        console.error('[Auth] Logout error:', err);
        return next(err);
      }
      res.json({ success: true });
    });
  });

  authRouter.get("/user", (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({
          success: false,
          error: { 
            message: "Not authenticated",
            code: "AUTH_REQUIRED"
          }
        });
      }

      const user = req.user as SelectUser;
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
          code: "SERVER_ERROR"
        }
      });
    }
  });

  // Mount auth routes before any other routes
  app.use('/api/auth', authRouter);
}