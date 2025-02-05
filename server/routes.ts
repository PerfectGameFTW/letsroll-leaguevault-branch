import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertBowlerSchema, insertPaymentSchema, insertLeagueSchema, insertTeamSchema } from "@shared/schema";
import { z } from "zod";

export function registerRoutes(app: Express): Server {
  // Leagues
  app.get("/api/leagues", async (_req, res) => {
    const leagues = await storage.getLeagues();
    res.json(leagues);
  });

  app.get("/api/leagues/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const league = await storage.getLeague(id);
      if (!league) {
        return res.status(404).json({ message: "League not found" });
      }
      res.json(league);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/leagues", async (req, res) => {
    try {
      const league = insertLeagueSchema.parse(req.body);
      const created = await storage.createLeague(league);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.patch("/api/leagues/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const update = insertLeagueSchema.partial().parse(req.body);
      const updated = await storage.updateLeague(id, update);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.delete("/api/leagues/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteLeague(id);
      res.sendStatus(204);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Teams
  app.get("/api/teams", async (req, res) => {
    try {
      const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
      const teams = await storage.getTeams(leagueId);
      res.json(teams);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/teams/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const team = await storage.getTeam(id);
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }
      res.json(team);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/teams", async (req, res) => {
    try {
      const team = insertTeamSchema.parse(req.body);
      const created = await storage.createTeam(team);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.patch("/api/teams/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const update = insertTeamSchema.partial().parse(req.body);
      const updated = await storage.updateTeam(id, update);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.delete("/api/teams/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTeam(id);
      res.sendStatus(204);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Bowlers
  app.get("/api/bowlers", async (req, res) => {
    try {
      const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
      const bowlers = await storage.getBowlers(teamId);
      res.json(bowlers);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/bowlers", async (req, res) => {
    try {
      const bowler = insertBowlerSchema.parse(req.body);
      const created = await storage.createBowler(bowler);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.patch("/api/bowlers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const update = insertBowlerSchema.partial().parse(req.body);
      const updated = await storage.updateBowler(id, update);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.delete("/api/bowlers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBowler(id);
      res.sendStatus(204);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Square Integration
  app.post("/api/square/customers", async (req, res) => {
    try {
      const { name, email } = z.object({
        name: z.string(),
        email: z.string().email(),
      }).parse(req.body);

      // TODO: Replace with actual Square API call once credentials are configured
      // For now, simulate customer creation for testing
      const customer = {
        id: `sandbox_${Date.now()}`,
        name,
        email,
      };

      res.status(201).json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        console.error('Square customer creation error:', error);
        res.status(500).json({ message: "Failed to create Square customer" });
      }
    }
  });

  // Payments
  app.get("/api/payments", async (req, res) => {
    try {
      const bowlerId = req.query.bowlerId ? parseInt(req.query.bowlerId as string) : undefined;
      const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
      const payments = await storage.getPayments(bowlerId, leagueId);
      res.json(payments);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/payments", async (req, res) => {
    try {
      const payment = insertPaymentSchema.parse(req.body);
      const created = await storage.createPayment(payment);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.post("/api/payments/process", async (req, res) => {
    try {
      const { sourceId, amount, locationId } = req.body;

      // TODO: Replace with actual Square API call once credentials are configured
      // For now, simulate a successful payment for testing
      const squarePayment = {
        id: `sandbox_${Date.now()}`,
        status: "paid",
        amount: amount,
        card: {
          last4: "1111",
          brand: "VISA"
        }
      };

      res.json({
        id: squarePayment.id,
        status: squarePayment.status,
        card: squarePayment.card
      });
    } catch (error) {
      console.error('Payment processing error:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Payment processing failed" 
      });
    }
  });

  app.patch("/api/payments/:id/status", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, squarePaymentId } = z.object({
        status: z.string(),
        squarePaymentId: z.string().optional(),
      }).parse(req.body);

      const updated = await storage.updatePaymentStatus(id, status, squarePaymentId);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}