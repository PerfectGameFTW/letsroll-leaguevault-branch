import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express, Router, Request, Response, NextFunction } from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser, insertUserSchema } from "@shared/schema";
import { sanitizeUser, sendSuccess, sendError } from "./utils/api.js";
import { cacheFetch, cacheInvalidate } from "./utils/cache";
import { env, isDev } from "./config";
import { checkUserBelongsToOrg } from "./middleware/subdomain";
import { createLogger } from "./logger";
import { csrfProtection } from "./middleware/csrf";

const log = createLogger("Auth");

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
    log.error('Error comparing passwords:', error);
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
    (user.createdAt instanceof Date || (typeof user.createdAt === 'string' && !isNaN(Date.parse(user.createdAt))))
  );
}

export function setupAuth(app: Express) {
  const isProduction = !isDev;

  const sessionSettings: session.SessionOptions = {
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new PostgresSessionStore({
      pool,
      createTableIfMissing: true,
      pruneSessionInterval: 60,
      tableName: 'session'
    }),
    cookie: {
      secure: !isDev || !!env.REPLIT_DEPLOYMENT || !!env.REPLIT_DOMAINS,
      sameSite: (isDev && !!env.REPLIT_DOMAINS) ? "none" as const : "lax" as const,
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      ...(isProduction ? { domain: '.leaguevault.app' } : {}),
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
          log.error('Invalid user object structure for ID:', { userId });
          await comparePasswords(password, DUMMY_HASH);
          return done(null, false, { message: "Invalid user data structure" });
        }

        const isValidPassword = await comparePasswords(password, user.password);

        if (!isValidPassword) {
          return done(null, false, { message: "Invalid email or password" });
        }

        return done(null, user);
      } catch (error) {
        log.error('Login error:', error);
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
      const user = await cacheFetch(`user:${id}`, 60_000, () => storage.getUser(id));
      if (!user || !isValidUser(user)) {
        return done(null, null);
      }
      done(null, user);
    } catch (error) {
      log.error('Deserialization error:', error);
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

        return sendError(res, "Registration validation failed", 400, "VALIDATION_ERROR", validationErrors);
      }

      const existingUser = await storage.getUserByEmail(result.data.email);
      if (existingUser) {
        return sendError(res, "Email already registered", 400, "DUPLICATE_EMAIL");
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
        const bowler = organizationId
          ? await storage.getBowlerByEmail(result.data.email, organizationId)
          : await storage.getBowlerByEmailSystemAdmin(result.data.email);
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
                const baseUrl = getBaseUrl(org?.slug || req.orgSlug);
                sendTemplatedEmail('self_register_linked', result.data.email, {
                  bowler_name: bowler.name,
                  organization_name: org?.name || '',
                  organization_logo_url: org?.logo ? `${baseUrl}/api/organizations/${org.id}/logo` : '',
                  league_name: league.name,
                  dashboard_link: `${baseUrl}/bowler-dashboard`,
                }).catch(err => log.error('Failed to send self_register_linked email:', err));
              }
            }
          }
        }

        if (!bowlerLinked) {
          const baseUrl = getBaseUrl(req.orgSlug);
          sendTemplatedEmail('self_register_unlinked', result.data.email, {
            bowler_name: result.data.name,
            login_link: `${baseUrl}/login`,
          }).catch(err => log.error('Failed to send self_register_unlinked email:', err));
        }
      } catch (linkError) {
        log.error('Auto-link bowler after registration failed:', linkError);
      }

      // Log the user in after registration
      req.login(user, (err) => {
        if (err) {
          log.error('Session creation after registration failed:', err);
          return sendError(res, "Failed to login after registration", 500, "SESSION_ERROR");
        }
        sendSuccess(res, sanitizeUser(user), 201);
      });
    } catch (error) {
      log.error('Registration error:', error);
      if (error instanceof z.ZodError) {
        return sendError(res, "Validation failed", 400, "VALIDATION_ERROR", error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message
        })));
      }
      sendError(res, "Failed to register user", 500, "SERVER_ERROR");
    }
  });

  authRouter.post("/login", loginLimiter, (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        log.error('Login error:', err);
        return sendError(res, "Internal server error", 500, "SERVER_ERROR");
      }
      if (!user) {
        return sendError(res, info?.message || "Invalid credentials", 401, "INVALID_CREDENTIALS");
      }
      req.login(user, async (err) => {
        if (err) {
          log.error('Session creation error:', err);
          return sendError(res, "Failed to create session", 500, "SESSION_ERROR");
        }

        if (req.subdomainOrg && !user.organizationId) {
          try {
            await checkUserBelongsToOrg(user, req.subdomainOrg.id);
          } catch (orgErr) {
            log.error('Failed to check org on login:', orgErr);
          }
        }

        log.info('Login successful', { userId: user.id, email: user.email, sessionId: req.sessionID, hostname: req.hostname, cookieDomain: req.session?.cookie?.domain || 'not set' });
        sendSuccess(res, sanitizeUser(user));
      });
    })(req, res, next);
  });

  authRouter.post("/logout", csrfProtection, (req, res, next) => {
    req.logout((err) => {
      if (err) {
        log.error('Logout error:', err);
        return next(err);
      }
      sendSuccess(res, null);
    });
  });

  authRouter.get("/user", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        log.info('/api/user unauthenticated request', { sessionId: req.sessionID, hasSession: !!req.session, hasCookie: !!req.headers.cookie, hostname: req.hostname });
        return sendError(res, "Not authenticated", 401, "AUTH_REQUIRED");
      }

      const user = req.user as SelectUser;
      const subdomainOrg = req.subdomainOrg;

      if (subdomainOrg) {
        const belongs = await checkUserBelongsToOrg(user, subdomainOrg.id);
        if (!belongs) {
          return new Promise<void>((resolve) => {
            req.logout((err) => {
              if (err) log.error('Logout error in /api/auth/user org guard:', err);
              sendError(res, "Not authenticated", 401, "AUTH_REQUIRED");
              resolve();
            });
          });
        }
      }

      sendSuccess(res, sanitizeUser(user));
    } catch (error) {
      log.error('Error in /api/user route:', error);
      sendError(res, "Internal server error", 500, "SERVER_ERROR");
    }
  });

  authRouter.post("/set-password", setPasswordLimiter, async (req, res) => {
    try {
      const { token, password } = req.body;

      if (!token || !password) {
        return sendError(res, "Token and password are required", 400, "VALIDATION_ERROR");
      }

      const passwordResult = passwordSchema.safeParse(password);
      if (!passwordResult.success) {
        return sendError(res, passwordResult.error.errors[0].message, 400, "VALIDATION_ERROR");
      }

      const user = await storage.getUserByInviteToken(token);
      if (!user || !user.inviteToken || !safeTokenCompare(token, user.inviteToken)) {
        return sendError(res, "Invalid or expired invitation link", 400, "INVALID_TOKEN");
      }

      if (user.inviteTokenExpiry && new Date(user.inviteTokenExpiry) < new Date()) {
        return sendError(res, "This invitation link has expired. Please ask your administrator to resend the invite.", 400, "TOKEN_EXPIRED");
      }

      const hashedPassword = await hashPassword(password);
      await Promise.all([
        storage.updateUser(user.id, { password: hashedPassword }),
        storage.clearUserInviteToken(user.id),
      ]);

      try {
        const bowler = await storage.getBowlerByEmailSystemAdmin(user.email);
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
        log.error('Auto-link bowler after set-password failed:', linkError);
      }

      req.login(user, (err) => {
        if (err) {
          log.error('Auto-login after password set failed:', err);
          return sendSuccess(res, { message: "Password set successfully. Please log in." });
        }
        sendSuccess(res, sanitizeUser(user));
      });
    } catch (error) {
      log.error('Set password error:', error);
      sendError(res, "Failed to set password", 500, "SERVER_ERROR");
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

  authRouter.post("/claim-bowler", claimLimiter, csrfProtection, async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return sendError(res, "Not authenticated", 401, "AUTH_REQUIRED");
      }

      const user = req.user as SelectUser;

      if (user.bowlerId) {
        return sendError(res, "You are already linked to a bowler", 400, "ALREADY_LINKED");
      }

      const { bowlerId } = req.body;
      if (!bowlerId || typeof bowlerId !== 'number') {
        return sendError(res, "Valid bowler ID is required", 400, "VALIDATION_ERROR");
      }

      const bowler = await storage.getBowler(bowlerId);
      if (!bowler) {
        return sendError(res, "Bowler not found", 404, "NOT_FOUND");
      }

      if (bowler.email && bowler.email.trim() !== '') {
        if (bowler.email.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
          return sendError(res, "You can only claim a bowler profile that matches your email address", 403, "FORBIDDEN");
        }
      }

      const alreadyLinked = await storage.isBowlerLinked(bowlerId);
      if (alreadyLinked) {
        return sendError(res, "This bowler is already linked to another account", 400, "ALREADY_LINKED");
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
          const baseUrl = getBaseUrl(org?.slug || req.orgSlug);
          sendTemplatedEmail('bowler_claimed', user.email, {
            bowler_name: bowler.name,
            organization_name: org?.name || '',
            organization_logo_url: org?.logo ? `${baseUrl}/api/organizations/${org.id}/logo` : '',
            league_name: league.name,
            dashboard_link: `${baseUrl}/bowler-dashboard`,
          }).catch(err => log.error('Failed to send bowler_claimed email:', err));
        }
      }

      const updatedUser = await storage.getUser(user.id);
      sendSuccess(res, sanitizeUser(updatedUser!));
    } catch (error) {
      log.error('Claim bowler error:', error);
      sendError(res, "Failed to claim bowler", 500, "SERVER_ERROR");
    }
  });

  authRouter.get("/validate-invite", async (req, res) => {
    try {
      const token = req.query.token as string;
      if (!token) {
        return sendError(res, "Token is required", 400, "VALIDATION_ERROR");
      }

      const user = await storage.getUserByInviteToken(token);
      if (!user || !user.inviteToken || !safeTokenCompare(token, user.inviteToken)) {
        return sendError(res, "Invalid invitation link", 400, "INVALID_TOKEN");
      }

      if (user.inviteTokenExpiry && new Date(user.inviteTokenExpiry) < new Date()) {
        return sendError(res, "This invitation link has expired", 400, "TOKEN_EXPIRED");
      }

      return sendSuccess(res, { name: user.name, email: user.email });
    } catch (error) {
      log.error('Validate invite error:', error);
      sendError(res, "Failed to validate invite", 500, "SERVER_ERROR");
    }
  });

  // Mount auth routes before any other routes
  app.use('/api/auth', authRouter);
}