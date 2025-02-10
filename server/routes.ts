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
    environment: 'sandbox' as const,
  });
}

// Add custom serializer for BigInt values
const customJSONReplacer = (key: string, value: any) => {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
};

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

      // Get all teams in the league
      const teams = await storage.getTeams(id);

      // Update all bowlers from these teams to remove team association
      for (const team of teams) {
        const teamBowlers = await storage.getBowlers(team.id);
        for (const bowler of teamBowlers) {
          await storage.updateBowler(bowler.id, {
            teamId: null,
            order: 0  // Set to 0 instead of null
          });
        }
        // Delete the team
        await storage.deleteTeam(team.id);
      }

      // Finally delete the league
      await storage.deleteLeague(id);
      res.sendStatus(204);
    } catch (error) {
      console.error('Error deleting league:', error);
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

  // Add this endpoint after the other team endpoints
  app.get("/api/teams/:id/bowlers", async (req, res) => {
    try {
      const teamId = parseInt(req.params.id);
      const team = await storage.getTeam(teamId);
      if (!team) {
        return res.status(404).json({ message: "Team not found" });
      }

      // Get bowlers directly assigned to this team
      const bowlers = await storage.getBowlers(teamId);

      // Sort bowlers by order if available
      const sortedBowlers = bowlers.sort((a, b) =>
        (a.order ?? 0) - (b.order ?? 0)
      );

      res.json(sortedBowlers);
    } catch (error) {
      console.error('Error fetching team bowlers:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Bowlers
  app.get("/api/bowlers", async (req, res) => {
    try {
      const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
      const bowlers = await storage.getBowlers(teamId);

      // For each bowler, fetch their team and league information
      const bowlersWithDetails = await Promise.all(bowlers.map(async (bowler) => {
        if (!bowler.teamAssignments) {
          return bowler;
        }

        const assignments = await Promise.all(bowler.teamAssignments.map(async (assignment) => {
          const team = await storage.getTeam(assignment.teamId);
          const league = team ? await storage.getLeague(team.leagueId) : null;
          return {
            ...assignment,
            teamName: team?.name,
            leagueName: league?.name
          };
        }));

        return {
          ...bowler,
          teamAssignments: assignments
        };
      }));

      // Sort bowlers by order
      bowlersWithDetails.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      res.json(bowlersWithDetails);
    } catch (error) {
      console.error('Error fetching bowlers:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/bowlers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const bowler = await storage.getBowler(id);
      if (!bowler) {
        return res.status(404).json({ message: "Bowler not found" });
      }
      res.json(bowler);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/bowlers", async (req, res) => {
    try {
      const bowler = insertBowlerSchema.parse(req.body);

      // Check if bowler with this email already exists
      const existingBowlers = await storage.getBowlers();
      const existingBowler = existingBowlers.find(b =>
        b.email.toLowerCase() === bowler.email.toLowerCase()
      );

      if (existingBowler) {
        return res.status(400).json({
          message: "A bowler with this email already exists"
        });
      }

      // Create bowler in database
      const created = await storage.createBowler(bowler);

      // Create or update Square customer
      if (squareClient) {
        try {
          // Search for existing customer by email
          const searchResponse = await squareClient.customersApi.searchCustomers({
            query: {
              filter: {
                emailAddress: {
                  exact: bowler.email.toLowerCase()
                }
              }
            }
          });

          let squareCustomerId: string;

          // If customer exists, use their ID
          if (searchResponse.result.customers && searchResponse.result.customers.length > 0) {
            const existingCustomer = searchResponse.result.customers[0];
            squareCustomerId = existingCustomer.id;

            // Update customer details
            await squareClient.customersApi.updateCustomer(squareCustomerId, {
              givenName: bowler.name.split(' ')[0],
              familyName: bowler.name.split(' ').slice(1).join(' ') || '',
              emailAddress: bowler.email.toLowerCase(),
            });
          } else {
            // Create new customer
            const customerResponse = await squareClient.customersApi.createCustomer({
              idempotencyKey: `${Date.now()}-${Math.random()}`,
              givenName: bowler.name.split(' ')[0],
              familyName: bowler.name.split(' ').slice(1).join(' ') || '',
              emailAddress: bowler.email.toLowerCase(),
            });

            if (!customerResponse.result?.customer?.id) {
              throw new Error('Failed to create Square customer');
            }

            squareCustomerId = customerResponse.result.customer.id;
          }

          // If bowler has leagues, handle league group assignments
          if (bowler.leagueIds && bowler.leagueIds.length > 0) {
            for (const leagueId of bowler.leagueIds) {
              const league = await storage.getLeague(leagueId);
              if (league) {
                // Find or create league group
                const groupsResponse = await squareClient.customerGroupsApi.listCustomerGroups();
                let groupId = groupsResponse.result.groups?.find(
                  (g) => g.name === league.name
                )?.id;

                if (!groupId) {
                  const groupResponse = await squareClient.customerGroupsApi.createCustomerGroup({
                    idempotencyKey: `league-${league.id}`,
                    group: {
                      name: league.name,
                    },
                  });
                  groupId = groupResponse.result.group?.id;
                }

                if (groupId) {
                  try {
                    await squareClient.customerGroupsApi.addCustomerToGroup(
                      groupId,
                      { customerId: squareCustomerId }
                    );
                  } catch (groupError) {
                    console.error('Error adding customer to group:', groupError);
                  }
                }
              }
            }
          }

          // Update bowler with Square customer ID
          await storage.updateBowler(created.id, {
            squareCustomerId
          });

          // Get updated bowler with Square ID
          const updatedBowler = await storage.getBowler(created.id);
          if (updatedBowler) {
            return res.status(201).json(updatedBowler);
          }
        } catch (squareError) {
          console.error('Square API error:', squareError);
          // Still return the created bowler even if Square integration fails
          return res.status(201).json(created);
        }
      }

      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        console.error('Error creating bowler:', error);
        res.status(500).json({
          message: error instanceof Error ? error.message : "Internal server error"
        });
      }
    }
  });

  app.patch("/api/bowlers/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const update = insertBowlerSchema.partial().parse(req.body);

      // If teamId and leagueId are provided, handle team assignment
      if (update.teamId !== undefined && update.leagueId !== undefined) {
        await storage.addBowlerTeam(id, update.teamId, update.leagueId);
      }

      // Handle other updates if any exist
      const updated = await storage.updateBowler(id, update);
      res.json(updated);
    } catch (error) {
      console.error('Error updating bowler:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        res.status(500).json({
          message: error instanceof Error ? error.message : "Internal server error"
        });
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

  // Add endpoints for managing bowler league associations
  app.post("/api/bowlers/:bowlerId/leagues/:leagueId", async (req, res) => {
    try {
      const bowlerId = parseInt(req.params.bowlerId);
      const leagueId = parseInt(req.params.leagueId);
      const created = await storage.addBowlerToLeague(bowlerId, leagueId);
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/bowlers/:bowlerId/leagues/:leagueId", async (req, res) => {
    try {
      const bowlerId = parseInt(req.params.bowlerId);
      const leagueId = parseInt(req.params.leagueId);
      await storage.removeBowlerFromLeague(bowlerId, leagueId);
      res.sendStatus(204);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/bowlers/:bowlerId/leagues", async (req, res) => {
    try {
      const bowlerId = parseInt(req.params.bowlerId);
      const bowlerLeagues = await storage.getBowlerLeagues(bowlerId);
      res.json(bowlerLeagues);
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

      console.log('Search response:', JSON.stringify(searchResponse.result, customJSONReplacer, 2));

      let customerId: string;

      // If customer exists, use their ID
      if (searchResponse.result.customers && searchResponse.result.customers.length > 0) {
        const existingCustomer = searchResponse.result.customers[0];
        console.log('Found existing customer:', JSON.stringify(existingCustomer, customJSONReplacer, 2));
        customerId = existingCustomer.id;

        // Update customer details if needed
        await squareClient.customersApi.updateCustomer(customerId, {
          givenName: name.split(' ')[0],
          familyName: name.split(' ').slice(1).join(' ') || '',
          emailAddress: email.toLowerCase(),
        });
      } else {
        console.log('No existing customer found, creating new one');
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

      res.status(201).json({
        id: customerId,
        name,
        email,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json(error.issues);
      } else {
        console.error('Square customer creation error:', error);
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to create Square customer"
        });
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

  app.get("/api/square/customers/:customerId/cards", async (req, res) => {
    try {
      if (!squareClient) {
        throw new Error("Square access token not configured");
      }

      const { customerId } = req.params;
      const response = await squareClient.customersApi.listCustomerCards(customerId);
      res.json(response.result.cards || []);
    } catch (error) {
      console.error('Error fetching stored cards:', error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to fetch stored cards"
      });
    }
  });

  app.post("/api/payments/process", async (req, res) => {
    try {
      const { sourceId, amount, locationId, customerId } = req.body;

      if (!squareClient) {
        throw new Error("Square access token not configured");
      }

      const payment = await squareClient.paymentsApi.createPayment({
        sourceId,
        customerId,
        amountMoney: {
          amount,
          currency: 'USD'
        },
        locationId,
        idempotencyKey: `${Date.now()}-${Math.random()}`
      });

      res.json(payment.result.payment);
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
        return res.json(searchResponse.result.loyaltyAccounts[0]);
      }

      // Enroll the customer in the loyalty program
      const enrollResponse = await squareClient.loyaltyApi.createLoyaltyAccount({
        loyaltyAccount: {
          programId,
          customerId,
        },
        idempotencyKey: `${Date.now()}-${Math.random()}`
      });

      res.json(enrollResponse.result.loyaltyAccount);
    } catch (error) {
      console.error('Loyalty enrollment error:', error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to enroll in loyalty program"
      });
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
        return res.status(404).json({
          message: "Customer is not enrolled in loyalty program"
        });
      }

      const loyaltyAccount = searchResponse.result.loyaltyAccounts[0];

      res.json({
        points: loyaltyAccount.balance,
        lifetimePoints: loyaltyAccount.lifetimePoints,
        enrolledAt: loyaltyAccount.createdAt,
      });
    } catch (error) {
      console.error('Loyalty points fetch error:', error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to fetch loyalty points"
      });
    }
  });


  const httpServer = createServer(app);
  return httpServer;
}