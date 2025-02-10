import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertBowlerSchema, insertPaymentSchema, insertLeagueSchema, insertTeamSchema, insertBowlerLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { ApiError, Client } from 'square';
import { sendSuccess, sendError } from './utils/api';

let squareClient: Client | null = null;
if (process.env.SQUARE_ACCESS_TOKEN) {
  squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: 'sandbox' as const,
  });
}

export function registerRoutes(app: Express): Server {
  // Leagues
  app.get("/api/leagues", async (_req, res) => {
    try {
      const leagues = await storage.getLeagues();
      sendSuccess(res, leagues);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/leagues/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const league = await storage.getLeague(id);
      if (!league) {
        return sendError(res, "League not found", 404, 'NOT_FOUND');
      }
      sendSuccess(res, league);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/leagues", async (req, res) => {
    try {
      const league = insertLeagueSchema.parse(req.body);
      const created = await storage.createLeague(league);
      sendSuccess(res, created, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        sendError(res, error);
      }
    }
  });

  app.patch("/api/leagues/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const update = insertLeagueSchema.partial().parse(req.body);
      const updated = await storage.updateLeague(id, update);
      sendSuccess(res, updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        sendError(res, error);
      }
    }
  });

  app.delete("/api/leagues/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const teams = await storage.getTeams(id);

      for (const team of teams) {
        const teamBowlers = await storage.getBowlers(team.id);
        for (const bowler of teamBowlers) {
          await storage.updateBowler(bowler.id, { teamId: null, order: 0 });
        }
        await storage.deleteTeam(team.id);
      }

      await storage.deleteLeague(id);
      sendSuccess(res, null, 204);
    } catch (error) {
      sendError(res, error);
    }
  });

  // Teams
  app.get("/api/teams", async (req, res) => {
    try {
      const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
      const teams = await storage.getTeams(leagueId);
      sendSuccess(res, teams);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/teams/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const team = await storage.getTeam(id);
      if (!team) {
        return sendError(res, "Team not found", 404, 'NOT_FOUND');
      }
      sendSuccess(res, team);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/teams", async (req, res) => {
    try {
      const team = insertTeamSchema.parse(req.body);
      const created = await storage.createTeam(team);
      sendSuccess(res, created, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        sendError(res, error);
      }
    }
  });

  app.patch("/api/teams/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const update = insertTeamSchema.partial().parse(req.body);
      const updated = await storage.updateTeam(id, update);
      sendSuccess(res, updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        sendError(res, error);
      }
    }
  });

  app.delete("/api/teams/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTeam(id);
      sendSuccess(res, null, 204);
    } catch (error) {
      sendError(res, error);
    }
  });

  // Bowlers
  app.get("/api/bowlers", async (req, res) => {
    try {
      const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
      const bowlers = await storage.getBowlers(teamId);
      if (!Array.isArray(bowlers)) {
        sendError(res, "Invalid bowlers data format", 500);
        return;
      }
      bowlers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      sendSuccess(res, bowlers);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/bowlers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const bowler = await storage.getBowler(id);
      if (!bowler) {
        return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
      }
      sendSuccess(res, bowler);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/bowlers", async (req, res) => {
    try {
      const bowler = insertBowlerSchema.parse(req.body);

      const existingBowlers = await storage.getBowlers();
      const existingBowler = existingBowlers.find(b => 
        b.email.toLowerCase() === bowler.email.toLowerCase()
      );

      if (existingBowler) {
        return sendError(res, "A bowler with this email already exists", 400, 'DUPLICATE_EMAIL');
      }

      if (bowler.teamId && !bowler.order) {
        const teamBowlers = await storage.getBowlers(bowler.teamId);
        bowler.order = teamBowlers.length;
      }

      const created = await storage.createBowler(bowler);

      if (squareClient) {
        try {
          const squareCustomerId = await handleSquareCustomer(created, bowler.teamId);
          if (squareCustomerId) {
            await storage.updateBowler(created.id, { squareCustomerId });
            const updatedBowler = await storage.getBowler(created.id);
            return sendSuccess(res, updatedBowler, 201);
          }
        } catch (squareError) {
          console.error('Square API error:', squareError);
        }
      }

      sendSuccess(res, created, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        sendError(res, error);
      }
    }
  });

  app.patch("/api/bowlers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const update = insertBowlerSchema.partial().parse(req.body);

      if (typeof update.order === 'number') {
        const bowler = await storage.getBowler(id);
        if (!bowler?.teamId) {
          return sendError(res, "Bowler must be assigned to a team to reorder", 400, 'INVALID_OPERATION');
        }

        const teamBowlers = await storage.getBowlers(bowler.teamId);
        teamBowlers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        const oldIndex = teamBowlers.findIndex(b => b.id === id);
        const newIndex = Math.min(Math.max(0, update.order), teamBowlers.length - 1);

        if (oldIndex === -1) {
          return sendError(res, "Bowler not found in team", 404, 'NOT_FOUND');
        }

        const [movedBowler] = teamBowlers.splice(oldIndex, 1);
        teamBowlers.splice(newIndex, 0, movedBowler);

        await Promise.all(teamBowlers.map((b, index) =>
          storage.updateBowler(b.id, { order: index })
        ));

        const updatedBowlers = await storage.getBowlers(bowler.teamId);
        updatedBowlers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return sendSuccess(res, updatedBowlers);
      }

      const updated = await storage.updateBowler(id, update);
      sendSuccess(res, updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        sendError(res, error);
      }
    }
  });

  app.delete("/api/bowlers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBowler(id);
      sendSuccess(res, null, 204);
    } catch (error) {
      sendError(res, error);
    }
  });

  // Bowler Leagues
  app.get("/api/bowler-leagues", async (req, res) => {
    try {
      const bowlerId = req.query.bowlerId ? parseInt(req.query.bowlerId as string) : undefined;
      const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
      const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;

      const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId, leagueId, teamId });
      if (!Array.isArray(bowlerLeagues)) {
        throw new Error("Invalid bowler leagues data format");
      }
      const sortedBowlerLeagues = bowlerLeagues.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      sendSuccess(res, { data: sortedBowlerLeagues });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/bowler-leagues", async (req, res) => {
    try {
      const association = insertBowlerLeagueSchema.parse(req.body);
      const existing = await storage.getBowlerLeagues({
        bowlerId: association.bowlerId,
        leagueId: association.leagueId,
        teamId: association.teamId
      });

      if (existing.length > 0) {
        return sendError(res, "Bowler is already assigned to this league and team", 400, 'DUPLICATE_ASSOCIATION');
      }

      const teamBowlerLeagues = await storage.getBowlerLeagues({ teamId: association.teamId });
      association.order = teamBowlerLeagues.length;

      const created = await storage.createBowlerLeague(association);
      sendSuccess(res, created, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        sendError(res, error);
      }
    }
  });

  app.patch("/api/bowler-leagues/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const update = insertBowlerLeagueSchema.partial().parse(req.body);

      // If we're updating the order, handle reordering
      if (typeof update.order === 'number') {
        const bowlerLeague = await storage.getBowlerLeague(id);
        if (!bowlerLeague) {
          return sendError(res, "Bowler league association not found", 404, 'NOT_FOUND');
        }

        // Get all bowler leagues for the team and sort them
        const teamBowlerLeagues = await storage.getBowlerLeagues({ teamId: bowlerLeague.teamId });
        teamBowlerLeagues.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        const oldIndex = teamBowlerLeagues.findIndex(bl => bl.id === id);
        const newIndex = Math.min(Math.max(0, update.order), teamBowlerLeagues.length - 1);

        if (oldIndex === -1) {
          return sendError(res, "Bowler league not found in team", 404, 'NOT_FOUND');
        }

        // Remove from old position and insert at new position
        const [moved] = teamBowlerLeagues.splice(oldIndex, 1);
        teamBowlerLeagues.splice(newIndex, 0, moved);

        // Update all bowler leagues with their new order
        await Promise.all(teamBowlerLeagues.map((bl, index) =>
          storage.updateBowlerLeague(bl.id, { order: index })
        ));

        // Return the updated and sorted list
        const updatedBowlerLeagues = await storage.getBowlerLeagues({ teamId: bowlerLeague.teamId });
        updatedBowlerLeagues.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return sendSuccess(res, updatedBowlerLeagues);
      }

      // Handle non-order updates
      const updated = await storage.updateBowlerLeague(id, update);
      sendSuccess(res, updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        sendError(res, error);
      }
    }
  });

  // Square Integration
  app.post("/api/square/customers", async (req, res) => {
    try {
      const { name, email, teamId } = z.object({
        name: z.string(),
        email: z.string().email(),
        teamId: z.number().optional(),
      }).parse(req.body);

      if (!squareClient) {
        throw new Error("Square access token not configured");
      }

      // First, search for existing customer by email
      const searchResponse = await squareClient.customersApi.searchCustomers({
        query: {
          filter: {
            emailAddress: {
              exact: email.toLowerCase()
            }
          }
        }
      });

      let customerId: string;

      // If customer exists, use their ID
      if (searchResponse.result.customers && searchResponse.result.customers.length > 0) {
        const existingCustomer = searchResponse.result.customers[0];
        customerId = existingCustomer.id;

        // Update customer details if needed
        await squareClient.customersApi.updateCustomer(customerId, {
          givenName: name.split(' ')[0],
          familyName: name.split(' ').slice(1).join(' ') || '',
          emailAddress: email.toLowerCase(),
        });
      } else {
        // Create new customer if none exists
        const customerResponse = await squareClient.customersApi.createCustomer({
          idempotencyKey: `${Date.now()}-${Math.random()}`,
          givenName: name.split(' ')[0],
          familyName: name.split(' ').slice(1).join(' ') || '',
          emailAddress: email.toLowerCase(),
        });

        if (!customerResponse.result?.customer?.id) {
          throw new Error('Failed to create Square customer');
        }

        customerId = customerResponse.result.customer.id;
      }

      // Only proceed with group management if teamId is provided
      let groupId: string | undefined;

      if (teamId) {
        // Get the team and league information
        const team = await storage.getTeam(teamId);
        if (!team) {
          throw new Error("Team not found");
        }

        const league = await storage.getLeague(team.leagueId);
        if (!league) {
          throw new Error("League not found");
        }

        // First try to find if the league group already exists
        const groupsResponse = await squareClient.customerGroupsApi.listCustomerGroups();
        const existingGroup = groupsResponse.result.groups?.find(
          (g) => g.name === league.name
        );

        if (existingGroup) {
          groupId = existingGroup.id;
        } else {
          // Create new group if it doesn't exist
          const groupResponse = await squareClient.customerGroupsApi.createCustomerGroup({
            idempotencyKey: `league-${league.id}`,
            group: {
              name: league.name,
            },
          });
          groupId = groupResponse.result.group?.id;
        }

        if (!groupId) {
          throw new Error("Failed to create or find league group");
        }
      }

      // Only add to group if we have both groupId and customer
      if (groupId) {
        try {
          await squareClient.customerGroupsApi.addCustomerToGroup(
            groupId,
            {
              customerId: customerId
            }
          );
        } catch (groupError) {
          console.error('Error adding customer to group:', groupError);
          // Don't throw here, as we still want to return the customer info
        }
      }

      sendSuccess(res, { id: customerId, name, email }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        console.error('Square customer creation error:', error);
        sendError(res, error instanceof Error ? error.message : "Failed to create Square customer", 500);
      }
    }
  });

  // Payments
  app.get("/api/payments", async (req, res) => {
    try {
      const bowlerId = req.query.bowlerId ? parseInt(req.query.bowlerId as string) : undefined;
      const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
      const payments = await storage.getPayments(bowlerId, leagueId);
      sendSuccess(res, payments);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/payments", async (req, res) => {
    try {
      const payment = insertPaymentSchema.parse(req.body);
      const created = await storage.createPayment(payment);
      sendSuccess(res, created, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        sendError(res, error);
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

      sendSuccess(res, {
        id: squarePayment.id,
        status: squarePayment.status,
        card: squarePayment.card
      });
    } catch (error) {
      console.error('Payment processing error:', error);
      sendError(res, error instanceof Error ? error.message : "Payment processing failed", 500);
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
      sendSuccess(res, updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendError(res, error, 400);
      } else {
        sendError(res, error);
      }
    }
  });

  // Loyalty Program Integration
  app.post("/api/square/loyalty/enroll", async (req, res) => {
    try {
      const { customerId } = z.object({
        customerId: z.string(),
      }).parse(req.body);

      if (!squareClient) {
        throw new Error("Square access token not configured");
      }

      // First, check if a loyalty program exists
      const programResponse = await squareClient.loyaltyApi.listLoyaltyPrograms();

      if (!programResponse.result.programs || programResponse.result.programs.length === 0) {
        throw new Error("No loyalty program found. Please set up a loyalty program in Square Dashboard first.");
      }

      const programId = programResponse.result.programs[0].id;

      // Check if customer is already enrolled
      const searchResponse = await squareClient.loyaltyApi.searchLoyaltyAccounts({
        query: {
          customerIds: [customerId]
        }
      });

      if (searchResponse.result.loyaltyAccounts && searchResponse.result.loyaltyAccounts.length > 0) {
        sendSuccess(res, searchResponse.result.loyaltyAccounts[0]);
      }

      // Enroll the customer in the loyalty program
      const enrollResponse = await squareClient.loyaltyApi.createLoyaltyAccount({
        loyaltyAccount: {
          programId,
          customerId,
        },
        idempotencyKey: `${Date.now()}-${Math.random()}`
      });

      sendSuccess(res, enrollResponse.result.loyaltyAccount);
    } catch (error) {
      console.error('Loyalty enrollment error:', error);
      sendError(res, error instanceof Error ? error.message : "Failed to enroll in loyalty program", 500);
    }
  });

  app.get("/api/square/loyalty/points/:customerId", async (req, res) => {
    try {
      const { customerId } = req.params;

      if (!squareClient) {
        throw new Error("Square access token not configured");
      }

      // Search for customer's loyalty account
      const searchResponse = await squareClient.loyaltyApi.searchLoyaltyAccounts({
        query: {
          customerIds: [customerId]
        }
      });

      if (!searchResponse.result.loyaltyAccounts || searchResponse.result.loyaltyAccounts.length === 0) {
        return sendError(res, "Customer is not enrolled in loyalty program", 404, 'NOT_FOUND');
      }

      const loyaltyAccount = searchResponse.result.loyaltyAccounts[0];

      sendSuccess(res, {
        points: loyaltyAccount.balance,
        lifetimePoints: loyaltyAccount.lifetimePoints,
        enrolledAt: loyaltyAccount.createdAt,
      });
    } catch (error) {
      console.error('Loyalty points fetch error:', error);
      sendError(res, error instanceof Error ? error.message : "Failed to fetch loyalty points", 500);
    }
  });


  const httpServer = createServer(app);
  return httpServer;
}

async function handleSquareCustomer(bowler: any, teamId?: number | null) {
    if (!squareClient) return null;

    const searchResponse = await squareClient.customersApi.searchCustomers({
      query: {
        filter: {
          emailAddress: {
            exact: bowler.email.toLowerCase()
          }
        }
      }
    });

    let customerId: string;

    if (searchResponse.result.customers?.length) {
      customerId = searchResponse.result.customers[0].id;
      await squareClient.customersApi.updateCustomer(customerId, {
        givenName: bowler.name.split(' ')[0],
        familyName: bowler.name.split(' ').slice(1).join(' ') || '',
        emailAddress: bowler.email.toLowerCase(),
      });
    } else {
      const customerResponse = await squareClient.customersApi.createCustomer({
        idempotencyKey: `${Date.now()}-${Math.random()}`,
        givenName: bowler.name.split(' ')[0],
        familyName: bowler.name.split(' ').slice(1).join(' ') || '',
        emailAddress: bowler.email.toLowerCase(),
      });

      if (!customerResponse.result?.customer?.id) {
        throw new Error('Failed to create Square customer');
      }

      customerId = customerResponse.result.customer.id;
    }

    if (teamId) {
      await handleSquareGroup(customerId, teamId);
    }

    return customerId;
  }

  async function handleSquareGroup(customerId: string, teamId: number) {
    if (!squareClient) return;

    const team = await storage.getTeam(teamId);
    if (!team) return;

    const league = await storage.getLeague(team.leagueId);
    if (!league) return;

    const groupsResponse = await squareClient.customerGroupsApi.listCustomerGroups();
    let groupId = groupsResponse.result.groups?.find(g => g.name === league.name)?.id;

    if (!groupId) {
      const groupResponse = await squareClient.customerGroupsApi.createCustomerGroup({
        idempotencyKey: `league-${league.id}`,
        group: { name: league.name },
      });
      groupId = groupResponse.result.group?.id;
    }

    if (groupId) {
      try {
        await squareClient.customerGroupsApi.addCustomerToGroup(groupId, { customerId });
      } catch (error) {
        console.error('Error adding customer to group:', error);
      }
    }
  }