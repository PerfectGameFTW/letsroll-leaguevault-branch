import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, Router } from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser, insertUserSchema } from "@shared/schema";
import { sanitizeUser } from "./utils/api.js";

function safeTokenCompare(provided: unknown, stored: unknown): boolean {
  if (typeof provided !== 'string' || typeof stored !== 'string') {
    return false;
  }
  const providedBuf = Buffer.from(provided, 'utf-8');
  const storedBuf = Buffer.from(stored, 'utf-8');
  if (providedBuf.length !== storedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, storedBuf);
}
import { z } from "zod";
import { passwordSchema } from "@shared/password-validation";
import connectPg from "connect-pg-simple";
import { pool } from "./db";
import { sendTemplatedEmail, getBaseUrl } from "./services/email.js";

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

const DUMMY_HASH = '2f9f2c9675648aa136c5b1e089432e102f593725bba27de669a6a6c140fb07824e54678ada643212884f3e2402b6fc1fa8024243ec3b49c6f483cb4daf01411d.07178debc1ee62255438ded3ad0ea7de';

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
    typeof user.role === 'string' &&
    user.createdAt instanceof Date
  );
}

export function setupAuth(app: Express) {
  if (!process.env.SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET must be set. Sessions cannot be secured without a signing key.",
    );
  }

  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new PostgresSessionStore({
      pool,
      createTableIfMissing: true,
      pruneSessionInterval: 60,
      tableName: 'session'
    }),
    cookie: {
      secure: process.env.NODE_ENV === "production" || !!process.env.REPLIT_DEPLOYMENT,
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
          await comparePasswords(password, DUMMY_HASH);
          return done(null, false, { message: "Invalid email or password" });
        }

        if (!isValidUser(user)) {
          const userId = user && typeof user === 'object' ? (user as Record<string, unknown>).id : undefined;
          console.error('[Auth] Invalid user object structure for ID:', userId);
          await comparePasswords(password, DUMMY_HASH);
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

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { message: "Too many login attempts, please try again later", code: "RATE_LIMITED" }
    }
  });

  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { message: "Too many requests, please try again later", code: "RATE_LIMITED" }
    }
  });

  const setPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { message: "Too many requests, please try again later", code: "RATE_LIMITED" }
    }
  });

  // Auth routes - ensure these are mounted before any other routes
  const authRouter = Router();

  // Register auth endpoints
  authRouter.post("/register", registerLimiter, async (req, res) => {
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
        role: 'user',
      });

      const organizationId = req.body.organizationId ? parseInt(req.body.organizationId) : undefined;

      let bowlerLinked = false;
      try {
        const bowler = await storage.getBowlerByEmail(result.data.email, organizationId);
        if (bowler) {
          const alreadyLinked = await storage.isBowlerLinked(bowler.id);
          if (!alreadyLinked) {
            await storage.linkUserToBowler(user.id, bowler.id);
            bowlerLinked = true;

            const bowlerLeagueEntries = await storage.getBowlerLeagues({ bowlerId: bowler.id });
            if (bowlerLeagueEntries.length > 0) {
              const league = await storage.getLeague(bowlerLeagueEntries[0].leagueId);
              if (league?.organizationId) {
                const [, org] = await Promise.all([
                  storage.setUserOrganization(user.id, league.organizationId),
                  storage.getOrganization(league.organizationId),
                ]);
                const baseUrl = getBaseUrl();
                sendTemplatedEmail('self_register_linked', result.data.email, {
                  bowler_name: bowler.name,
                  organization_name: org?.name || '',
                  organization_logo_url: org?.logo ? `${baseUrl}/api/organizations/${org.id}/logo` : '',
                  league_name: league.name,
                  dashboard_link: `${baseUrl}/bowler-dashboard`,
                }).catch(err => console.error('[Auth] Failed to send self_register_linked email:', err));
              }
            }
          }
        }

        if (!bowlerLinked) {
          const baseUrl = getBaseUrl();
          sendTemplatedEmail('self_register_unlinked', result.data.email, {
            bowler_name: result.data.name,
            login_link: `${baseUrl}/login`,
          }).catch(err => console.error('[Auth] Failed to send self_register_unlinked email:', err));
        }
      } catch (linkError) {
        console.error('[Auth] Auto-link bowler after registration failed:', linkError);
      }

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
          data: sanitizeUser(user)
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

  authRouter.post("/login", loginLimiter, (req, res, next) => {
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
          data: sanitizeUser(user)
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
        data: sanitizeUser(user)
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

  authRouter.post("/set-password", setPasswordLimiter, async (req, res) => {
    try {
      const { token, password } = req.body;

      if (!token || !password) {
        return res.status(400).json({
          success: false,
          error: { message: "Token and password are required" }
        });
      }

      const passwordResult = passwordSchema.safeParse(password);
      if (!passwordResult.success) {
        return res.status(400).json({
          success: false,
          error: { message: passwordResult.error.errors[0].message }
        });
      }

      const user = await storage.getUserByInviteToken(token);
      if (!user || !user.inviteToken || !safeTokenCompare(token, user.inviteToken)) {
        return res.status(400).json({
          success: false,
          error: { message: "Invalid or expired invitation link" }
        });
      }

      if (user.inviteTokenExpiry && new Date(user.inviteTokenExpiry) < new Date()) {
        return res.status(400).json({
          success: false,
          error: { message: "This invitation link has expired. Please ask your administrator to resend the invite." }
        });
      }

      const hashedPassword = await hashPassword(password);
      await Promise.all([
        storage.updateUser(user.id, { password: hashedPassword }),
        storage.clearUserInviteToken(user.id),
      ]);

      try {
        const bowler = await storage.getBowlerByEmail(user.email);
        if (bowler) {
          const alreadyLinked = await storage.isBowlerLinked(bowler.id);
          if (!alreadyLinked) {
            await storage.linkUserToBowler(user.id, bowler.id);

            if (!user.organizationId) {
              const bowlerLeagueEntries = await storage.getBowlerLeagues({ bowlerId: bowler.id });
              if (bowlerLeagueEntries.length > 0) {
                const league = await storage.getLeague(bowlerLeagueEntries[0].leagueId);
                if (league?.organizationId) {
                  await storage.setUserOrganization(user.id, league.organizationId);
                }
              }
            }
          }
        }
      } catch (linkError) {
        console.error('[Auth] Auto-link bowler after set-password failed:', linkError);
      }

      req.login(user, (err) => {
        if (err) {
          console.error('[Auth] Auto-login after password set failed:', err);
          return res.json({
            success: true,
            data: { message: "Password set successfully. Please log in." }
          });
        }
        res.json({
          success: true,
          data: sanitizeUser(user)
        });
      });
    } catch (error) {
      console.error('[Auth] Set password error:', error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to set password" }
      });
    }
  });

  const claimLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { message: "Too many requests, please try again later", code: "RATE_LIMITED" }
    }
  });

  authRouter.post("/claim-bowler", claimLimiter, async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({
          success: false,
          error: { message: "Not authenticated" }
        });
      }

      const user = req.user as SelectUser;

      if (user.bowlerId) {
        return res.status(400).json({
          success: false,
          error: { message: "You are already linked to a bowler" }
        });
      }

      const { bowlerId } = req.body;
      if (!bowlerId || typeof bowlerId !== 'number') {
        return res.status(400).json({
          success: false,
          error: { message: "Valid bowler ID is required" }
        });
      }

      const bowler = await storage.getBowler(bowlerId);
      if (!bowler) {
        return res.status(404).json({
          success: false,
          error: { message: "Bowler not found" }
        });
      }

      if (bowler.email && bowler.email.trim() !== '') {
        if (bowler.email.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
          return res.status(403).json({
            success: false,
            error: { message: "You can only claim a bowler profile that matches your email address" }
          });
        }
      }

      const alreadyLinked = await storage.isBowlerLinked(bowlerId);
      if (alreadyLinked) {
        return res.status(400).json({
          success: false,
          error: { message: "This bowler is already linked to another account" }
        });
      }

      await Promise.all([
        storage.linkUserToBowler(user.id, bowlerId),
        storage.updateBowler(bowlerId, { ...bowler, email: user.email }),
      ]);

      const bowlerLeagueEntries = await storage.getBowlerLeagues({ bowlerId });
      if (bowlerLeagueEntries.length > 0) {
        const league = await storage.getLeague(bowlerLeagueEntries[0].leagueId);
        if (league?.organizationId) {
          const [, org] = await Promise.all([
            !user.organizationId
              ? storage.setUserOrganization(user.id, league.organizationId)
              : Promise.resolve(null),
            storage.getOrganization(league.organizationId),
          ]);
          const baseUrl = getBaseUrl();
          sendTemplatedEmail('bowler_claimed', user.email, {
            bowler_name: bowler.name,
            organization_name: org?.name || '',
            organization_logo_url: org?.logo ? `${baseUrl}/api/organizations/${org.id}/logo` : '',
            league_name: league.name,
            dashboard_link: `${baseUrl}/bowler-dashboard`,
          }).catch(err => console.error('[Auth] Failed to send bowler_claimed email:', err));
        }
      }

      const updatedUser = await storage.getUser(user.id);
      res.json({
        success: true,
        data: sanitizeUser(updatedUser!)
      });
    } catch (error) {
      console.error('[Auth] Claim bowler error:', error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to claim bowler" }
      });
    }
  });

  authRouter.get("/validate-invite", async (req, res) => {
    try {
      const token = req.query.token as string;
      if (!token) {
        return res.status(400).json({ success: false, error: { message: "Token is required" } });
      }

      const user = await storage.getUserByInviteToken(token);
      if (!user || !user.inviteToken || !safeTokenCompare(token, user.inviteToken)) {
        return res.json({ success: false, error: { message: "Invalid invitation link" } });
      }

      if (user.inviteTokenExpiry && new Date(user.inviteTokenExpiry) < new Date()) {
        return res.json({ success: false, error: { message: "This invitation link has expired" } });
      }

      return res.json({ success: true, data: { name: user.name, email: user.email } });
    } catch (error) {
      console.error('[Auth] Validate invite error:', error);
      res.status(500).json({ success: false, error: { message: "Failed to validate invite" } });
    }
  });

  // Mount auth routes before any other routes
  app.use('/api/auth', authRouter);
}