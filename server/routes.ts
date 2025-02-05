import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertBowlerSchema, insertPaymentSchema, insertLeagueSchema, insertTeamSchema } from "@shared/schema";
import { z } from "zod";
import { ApiError, Client } from 'square';

let squareClient: Client | null = null;
if (process.env.SQUARE_ACCESS_TOKEN) {
  squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: 'sandbox', // or 'production' for live
  });
}

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
      // Sort bowlers by order
      bowlers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      res.json(bowlers);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/bowlers", async (req, res) => {
    try {
      const bowler = insertBowlerSchema.parse(req.body);
      // If order is not provided, set it to the next available order number
      if (bowler.teamId && !bowler.order) {
        const teamBowlers = await storage.getBowlers(bowler.teamId);
        bowler.order = teamBowlers.length;
      }
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

      // If we're updating the order, we need to handle reordering
      if (typeof update.order === 'number') {
        const bowler = await storage.getBowler(id);
        if (!bowler?.teamId) {
          return res.status(400).json({ message: "Bowler must be assigned to a team to reorder" });
        }

        // Get all bowlers for the team and sort them by current order
        const teamBowlers = await storage.getBowlers(bowler.teamId);
        teamBowlers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        const oldIndex = teamBowlers.findIndex(b => b.id === id);
        const newIndex = Math.min(Math.max(0, update.order), teamBowlers.length - 1); // Clamp order value

        if (oldIndex === -1) {
          return res.status(404).json({ message: "Bowler not found in team" });
        }

        // Remove bowler from old position and insert at new position
        const [movedBowler] = teamBowlers.splice(oldIndex, 1);
        teamBowlers.splice(newIndex, 0, movedBowler);

        // Update all bowlers with their new sequential order
        await Promise.all(teamBowlers.map((b, index) =>
          storage.updateBowler(b.id, { order: index })
        ));

        // Return the updated and sorted list
        const updatedBowlers = await storage.getBowlers(bowler.teamId);
        updatedBowlers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return res.json(updatedBowlers);
      }

      // Handle non-order updates
      const updated = await storage.updateBowler(id, update);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        console.error('Error updating bowler:', error);
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
      const { name, email, teamId } = z.object({
        name: z.string(),
        email: z.string().email(),
        teamId: z.number(),
      }).parse(req.body);

      if (!squareClient) {
        throw new Error("Square access token not configured");
      }

      // Get the team and league information
      const team = await storage.getTeam(teamId);
      if (!team) {
        throw new Error("Team not found");
      }

      const league = await storage.getLeague(team.leagueId);
      if (!league) {
        throw new Error("League not found");
      }

      // First create or get the league group
      let groupId;
      try {
        // Try to create the group first
        const groupResponse = await squareClient.customerGroupsApi.createCustomerGroup({
          idempotencyKey: `league-${league.id}`,
          group: {
            name: league.name,
          },
        });
        groupId = groupResponse.result.group?.id;
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 400) {
          // Group might already exist, try to find it
          const groupsResponse = await squareClient.customerGroupsApi.listCustomerGroups();
          const existingGroup = groupsResponse.result.groups?.find(
            (g) => g.name === league.name
          );
          if (existingGroup) {
            groupId = existingGroup.id;
          }
        } else {
          throw error;
        }
      }

      if (!groupId) {
        throw new Error("Failed to create or find league group");
      }

      // Now create the customer
      const customerResponse = await squareClient.customersApi.createCustomer({
        idempotencyKey: `${Date.now()}-${Math.random()}`,
        givenName: name.split(' ')[0],
        familyName: name.split(' ').slice(1).join(' ') || '',
        emailAddress: email,
      });

      if (!customerResponse.result?.customer?.id) {
        throw new Error('Failed to create Square customer');
      }

      // Add the customer to the group
      await squareClient.customerGroupsApi.createCustomerGroupMembership({
        idempotencyKey: `membership-${customerResponse.result.customer.id}-${groupId}`,
        membership: {
          customerId: customerResponse.result.customer.id,
          groupId: groupId,
        },
      });

      res.status(201).json({
        id: customerResponse.result.customer.id,
        name,
        email,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        console.error('Square customer creation error:', error);
        res.status(500).json({ message: error instanceof Error ? error.message : "Failed to create Square customer" });
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