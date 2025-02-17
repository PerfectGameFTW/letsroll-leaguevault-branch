import { setupAuth } from './auth.js';
import type { Express } from "express";
import { storage } from "./storage.js";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export function registerRoutes(app: Express) {
  // Setup authentication routes and middleware
  setupAuth(app);

  // Handle bowler creation with password hashing
  app.post("/api/bowlers", async (req, res) => {
    try {
      const { password, ...bowlerData } = req.body;
      const hashedPassword = await hashPassword(password);

      const bowler = await storage.createBowler({
        ...bowlerData,
        passwordHash: hashedPassword,
        active: true,
        order: 0
      });

      // Log in the user after successful registration
      req.login(bowler, (err) => {
        if (err) {
          console.error("[Routes] Login after registration failed:", err);
          return res.status(500).json({ error: "Registration successful but login failed" });
        }
        res.status(201).json(bowler);
      });
    } catch (error) {
      console.error("[Routes] Bowler creation error:", error);
      res.status(500).json({ error: "Failed to create bowler" });
    }
  });
}