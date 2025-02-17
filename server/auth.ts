import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { Bowler } from "@shared/schema";

declare global {
  namespace Express {
    interface User extends Bowler {}
  }
}

const scryptAsync = promisify(scrypt);

async function comparePasswords(supplied: string, stored: string) {
  try {
    console.log("[Auth] Comparing passwords, stored hash length:", stored.length);
    const [hashed, salt] = stored.split(".");

    if (!hashed || !salt) {
      console.error("[Auth] Invalid stored password format");
      return false;
    }

    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
    return timingSafeEqual(hashedBuf, suppliedBuf);
  } catch (error) {
    console.error("[Auth] Error comparing passwords:", error);
    return false;
  }
}

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    }
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password'
      },
      async (email, password, done) => {
        try {
          console.log("[Auth] Attempting login for email:", email);
          const bowler = await storage.getBowlerByEmail(email);

          if (!bowler) {
            console.log("[Auth] Login failed: Bowler not found");
            return done(null, false, { message: "Invalid email or password" });
          }

          if (!bowler.passwordHash) {
            console.log("[Auth] Login failed: No password hash found for bowler");
            return done(null, false, { message: "Invalid email or password" });
          }

          try {
            const isValid = await comparePasswords(password, bowler.passwordHash);
            console.log("[Auth] Password validation result:", isValid);
            if (!isValid) {
              console.log("[Auth] Login failed: Invalid password");
              return done(null, false, { message: "Invalid email or password" });
            }
            console.log("[Auth] Login successful for email:", email);
            return done(null, bowler);
          } catch (error) {
            console.error("[Auth] Password comparison error:", error);
            return done(null, false, { message: "Invalid email or password" });
          }
        } catch (error) {
          console.error("[Auth] Login error:", error);
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user, done) => {
    console.log("[Auth] Serializing user:", user.id);
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      console.log("[Auth] Deserializing user:", id);
      const bowler = await storage.getBowler(id);
      done(null, bowler);
    } catch (error) {
      console.error("[Auth] Deserialization error:", error);
      done(error);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: Error, user: Express.User, info: { message: string }) => {
      if (err) {
        console.error("[Auth] Login error:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
      if (!user) {
        return res.status(401).json({ error: info.message || "Invalid credentials" });
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error("[Auth] Login error:", loginErr);
          return res.status(500).json({ error: "Failed to log in" });
        }
        return res.json(user);
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    res.json(req.user);
  });
}