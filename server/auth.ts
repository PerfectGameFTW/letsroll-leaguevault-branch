import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
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
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Validate user object has required fields
function isValidUser(user: any): user is SelectUser {
  return (
    user &&
    typeof user === 'object' &&
    typeof user.id === 'number' &&
    typeof user.email === 'string' &&
    typeof user.password === 'string' &&
    (user.bowlerId === null || typeof user.bowlerId === 'number') &&
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
      pruneSessionInterval: 60, // Cleanup expired sessions every minute
      tableName: 'session' // Explicitly set table name
    }),
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
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
    }, async (email, password, done) => {
      try {
        console.log(`[Auth] Attempting login for email: ${email}`);
        const user = await storage.getUserByEmail(email);

        if (!user) {
          console.log(`[Auth] No user found with email: ${email}`);
          return done(null, false, { message: "Invalid email or password" });
        }

        if (!isValidUser(user)) {
          console.error('[Auth] Invalid user object structure:', user);
          return done(null, false, { message: "Invalid user data structure" });
        }

        const isValidPassword = await comparePasswords(password, user.password);
        if (!isValidPassword) {
          console.log(`[Auth] Invalid password for email: ${email}`);
          return done(null, false, { message: "Invalid email or password" });
        }

        console.log(`[Auth] Login successful for user ID: ${user.id}`);
        return done(null, user);
      } catch (error) {
        console.error('[Auth] Login error:', error);
        return done(error);
      }
    }),
  );

  passport.serializeUser((user, done) => {
    try {
      console.log(`[Auth] Serializing user ID: ${user.id}`);
      if (!isValidUser(user)) {
        console.error('[Auth] Invalid user object during serialization:', user);
        return done(new Error('Invalid user object during serialization'));
      }
      done(null, user.id);
    } catch (error) {
      console.error('[Auth] Serialization error:', error);
      done(error);
    }
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      console.log(`[Auth] Deserializing user ID: ${id}`);
      const user = await storage.getUser(id);

      if (!user) {
        console.log(`[Auth] No user found for ID: ${id}`);
        return done(new Error(`User not found: ${id}`));
      }

      if (!isValidUser(user)) {
        console.error(`[Auth] Invalid user object for ID: ${id}`, user);
        return done(new Error(`Invalid user object: ${id}`));
      }

      console.log(`[Auth] Successfully deserialized user ID: ${id}`);
      done(null, user);
    } catch (error) {
      console.error('[Auth] Deserialization error:', error);
      done(error);
    }
  });

  // Auth routes
  app.post("/api/register", async (req, res, next) => {
    try {
      console.log('[Auth] Processing registration request:', { email: req.body.email });

      // Validate input against schema
      const validatedInput = insertUserSchema.safeParse({
        email: req.body.email,
        password: req.body.password,
        bowlerId: req.body.bowlerId || null
      });

      if (!validatedInput.success) {
        console.log('[Auth] Registration validation failed:', validatedInput.error);
        return res.status(400).json({
          success: false,
          error: { 
            message: "Validation failed", 
            details: validatedInput.error.errors 
          }
        });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(validatedInput.data.email);
      if (existingUser) {
        console.log(`[Auth] Registration failed - email already exists: ${validatedInput.data.email}`);
        return res.status(400).json({
          success: false,
          error: { message: "Email already registered" }
        });
      }

      // Create new user with hashed password
      const user = await storage.createUser({
        ...validatedInput.data,
        password: await hashPassword(validatedInput.data.password)
      });

      if (!isValidUser(user)) {
        console.error('[Auth] Created user has invalid structure:', user);
        throw new Error('Invalid user structure after creation');
      }

      console.log(`[Auth] User registered successfully, ID: ${user.id}`);

      // Log the user in after registration
      req.login(user, (err) => {
        if (err) {
          console.error('[Auth] Login after registration failed:', err);
          return next(err);
        }
        res.status(201).json({
          success: true,
          data: { ...user, password: undefined }
        });
      });
    } catch (error) {
      console.error('[Auth] Registration error:', error);
      next(error);
    }
  });

  app.get("/api/users/check-email/:email", async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      console.log(`[Auth] Checking email existence: ${email}`);
      const user = await storage.getUserByEmail(email);
      res.json({ exists: !!user });
    } catch (error) {
      console.error('[Auth] Email check error:', error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to check email" }
      });
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) {
        console.error('[Auth] Login error:', err);
        return next(err);
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
          return next(err);
        }
        console.log(`[Auth] Login successful for user ID: ${user.id}`);
        res.json({
          success: true,
          data: { ...user, password: undefined }
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
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

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      console.log('[Auth] Unauthorized access attempt to /api/user');
      return res.status(401).json({
        success: false,
        error: { message: "Not authenticated" }
      });
    }
    console.log(`[Auth] Current user data requested, ID: ${(req.user as SelectUser).id}`);
    res.json({
      success: true,
      data: { ...req.user, password: undefined }
    });
  });
}