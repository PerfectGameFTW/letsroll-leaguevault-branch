import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { randomBytes } from "crypto";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import { cacheFetch } from "./utils/cache";
import { env, isDev } from "./config";
import { createLogger } from "./logger";
import { pool } from "./db";
import { hashPassword, comparePasswords, safeTokenCompare } from "./lib/password";

// Re-export for backward compatibility with existing import sites.
export { hashPassword, safeTokenCompare };

const log = createLogger("Auth");

/**
 * Destroy every session belonging to `userId` EXCEPT `keepSid` (the
 * caller's current session). Used after a password change so a stolen
 * cookie on another device is invalidated immediately instead of
 * lingering until its own expiry.
 *
 * connect-pg-simple stores rows in the `session` table with a JSON
 * `sess` column; passport's serialized user id lives at
 * `sess->'passport'->>'user'` (TEXT). We compare as text since the
 * column is JSON-encoded.
 *
 * Returns the number of sessions destroyed. Errors are caught by
 * the caller — best-effort vs. blocking is up to the call site.
 */
export async function destroyOtherSessionsForUser(
  userId: number,
  keepSid: string | null,
): Promise<number> {
  const sql = keepSid
    ? `DELETE FROM "session" WHERE sess->'passport'->>'user' = $1 AND sid <> $2`
    : `DELETE FROM "session" WHERE sess->'passport'->>'user' = $1`;
  const params = keepSid ? [String(userId), keepSid] : [String(userId)];
  const result = await pool.query(sql, params);
  return result.rowCount ?? 0;
}

const PostgresSessionStore = connectPg(session);

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

let DUMMY_HASH: string;

async function initDummyHash() {
  DUMMY_HASH = await hashPassword(randomBytes(32).toString("hex"));
}

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

export async function setupAuth(app: Express) {
  await initDummyHash();
  const isProduction = !isDev;

  const sessionSettings: session.SessionOptions = {
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new PostgresSessionStore({
      pool,
      pruneSessionInterval: 60,
      tableName: 'session',
    }),
    cookie: {
      secure: !isDev || !!env.REPLIT_DEPLOYMENT || !!env.REPLIT_DOMAINS,
      sameSite: (isDev && !!env.REPLIT_DOMAINS) ? "none" as const : "lax" as const,
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      ...(isProduction ? { domain: `.${env.APP_DOMAIN}` } : {}),
    },
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy({
      usernameField: 'email',
      passwordField: 'password',
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

}
