import { Router } from 'express';
import { storage } from '../storage.js';
import { insertBowlerSchema, partialBowlerSchema } from "@shared/schema.js";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api.js';
import { createOrUpdateCustomer } from '../services/square.js';

// Helper function to check if a user has access to a team's organization
async function hasAccessToTeam(req: any, teamId: number): Promise<boolean> {
  // Admin users have access to all teams
  if (req.user?.isAdmin) {
    return true;
  }
  
  // Get the team to determine its league
  const team = await storage.getTeam(teamId);
  if (!team) {
    return false;
  }
  
  // Get the league to determine its organization
  const league = await storage.getLeague(team.leagueId);
  if (!league) {
    return false;
  }
  
  // If the league has no organization, it's accessible to all
  if (league.organizationId === null) {
    return true;
  }
  
  // Check if user belongs to the same organization as the league
  return req.user?.organizationId === league.organizationId;
}

const router = Router();

router.get("/", async (req, res) => {
  try {
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
    const ids = req.query.ids ? (req.query.ids as string).split(',').map(id => parseInt(id)) : undefined;

    console.log('[Bowlers] Fetching bowlers with params:', { teamId, ids });

    // Validate the teamId if provided
    if (teamId !== undefined && isNaN(teamId)) {
      return sendError(res, "Invalid team ID format", 400);
    }

    // Validate the ids if provided
    if (ids && ids.some(isNaN)) {
      return sendError(res, "Invalid bowler ID format in list", 400);
    }

    // If teamId is provided, check organization access
    if (teamId && !req.user?.isAdmin) {
      const hasAccess = await hasAccessToTeam(req, teamId);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this team's bowlers", 403, 'FORBIDDEN');
      }
    }

    // Fetch bowlers
    const bowlers = await storage.getBowlers(teamId);
    
    if (!bowlers || bowlers.length === 0) {
      console.log('[Bowlers] No bowlers found');
      return sendSuccess(res, []);
    }

    // If no teamId provided, we need to filter bowlers by organization
    let accessibleBowlers = bowlers;
    
    if (!teamId && !req.user?.isAdmin && req.user?.organizationId) {
      // Get all leagues in the user's organization
      const leagues = await storage.getLeagues(req.user.organizationId);
      if (!leagues || leagues.length === 0) {
        return sendSuccess(res, []);
      }
      
      // Get all teams in those leagues
      const leagueIds = leagues.map(l => l.id);
      const teams = await Promise.all(leagueIds.map(lId => storage.getTeams(lId)));
      const teamIds = teams.flat().map(t => t.id);
      
      // For each bowler, check if they are in one of the teams in user's organization
      const bowlerLeagues = await storage.getBowlerLeagues();
      const organizationBowlerIds = bowlerLeagues
        .filter(bl => teamIds.includes(bl.teamId))
        .map(bl => bl.bowlerId);
        
      accessibleBowlers = bowlers.filter(b => organizationBowlerIds.includes(b.id));
    }

    // Filter by IDs if provided
    const filteredBowlers = ids 
      ? accessibleBowlers.filter(b => ids.includes(b.id))
      : accessibleBowlers;

    console.log(`[Bowlers] Retrieved ${filteredBowlers.length} bowlers`);
    sendSuccess(res, filteredBowlers);
  } catch (error) {
    console.error('[Bowlers] Error fetching bowlers:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowlers');
  }
});

// Helper function to check if user has access to a bowler
async function hasAccessToBowler(req: any, bowlerId: number): Promise<boolean> {
  // Admin users have access to all bowlers
  if (req.user?.isAdmin) {
    return true;
  }

  // If the user has no organization, they can't access organization-specific data
  if (!req.user?.organizationId) {
    return false;
  }

  // Get bowler leagues to find the teams they're on
  const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId });
  if (!bowlerLeagues || bowlerLeagues.length === 0) {
    return false;
  }

  // Check each team to see if it belongs to the user's organization
  for (const bl of bowlerLeagues) {
    const team = await storage.getTeam(bl.teamId);
    if (!team) continue;

    const league = await storage.getLeague(team.leagueId);
    if (!league) continue;

    // If league has no organization or matches user's organization, allow access
    if (league.organizationId === null || league.organizationId === req.user.organizationId) {
      return true;
    }
  }

  return false;
}

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const bowler = await storage.getBowler(id);
    
    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }
    
    // Check organization access
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToBowler(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
      }
    }
    
    sendSuccess(res, bowler);
  } catch (error) {
    console.error('[Bowlers] Error fetching bowler:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowler');
  }
});

router.post("/", async (req, res) => {
  try {
    console.log('[Bowlers] Creating new bowler in sandbox mode:', {
      ...req.body,
      environment: 'sandbox'
    });

    const bowler = insertBowlerSchema.parse(req.body);
    
    // If teamId is provided in the request, verify organization access
    if (req.body.teamId && !req.user?.isAdmin) {
      const teamId = parseInt(req.body.teamId);
      
      if (!isNaN(teamId)) {
        const hasAccess = await hasAccessToTeam(req, teamId);
        if (!hasAccess) {
          return sendError(res, "You don't have access to add bowlers to this team", 403, 'FORBIDDEN');
        }
      }
    }

    // Check for existing bowler with same email if provided
    if (bowler.email) {
      const existingBowlers = await storage.getBowlers();
      
      // If user is not admin and belongs to an organization, filter existing bowlers by organization
      let filteredBowlers = existingBowlers;
      if (!req.user?.isAdmin && req.user?.organizationId) {
        // Get all leagues in the user's organization
        const leagues = await storage.getLeagues(req.user.organizationId);
        if (leagues && leagues.length > 0) {
          // Get all teams in those leagues
          const leagueIds = leagues.map(l => l.id);
          const teams = await Promise.all(leagueIds.map(lId => storage.getTeams(lId)));
          const teamIds = teams.flat().map(t => t.id);
          
          // For each bowler, check if they are in one of the teams in user's organization
          const bowlerLeagues = await storage.getBowlerLeagues();
          const organizationBowlerIds = bowlerLeagues
            .filter(bl => teamIds.includes(bl.teamId))
            .map(bl => bl.bowlerId);
            
          filteredBowlers = existingBowlers.filter(b => organizationBowlerIds.includes(b.id));
        }
      }
      
      const existingBowler = filteredBowlers.find(b =>
        b.email && b.email.toLowerCase() === bowler.email.toLowerCase()
      );

      if (existingBowler) {
        console.log('[Bowlers] Duplicate email found:', bowler.email);
        return sendError(res, "A bowler with this email already exists", 400, 'DUPLICATE_EMAIL');
      }
    }

    // Create bowler in database first
    const created = await storage.createBowler(bowler);
    console.log('[Bowlers] Bowler created in database:', created);

    // Then create Square customer in sandbox
    if (created.email) {
      try {
        console.log('[Bowlers] Creating Square customer in sandbox for:', {
          name: created.name,
          email: created.email
        });

        const squareCustomer = await createOrUpdateCustomer(created.name, created.email);
        console.log('[Bowlers] Square sandbox customer created:', {
          customerId: squareCustomer?.id,
          status: 'success'
        });

        if (squareCustomer) {
          const updated = await storage.updateBowler(created.id, {
            ...created,
            squareCustomerId: squareCustomer.id,
            active: true
          });
          console.log('[Bowlers] Bowler updated with Square sandbox ID:', {
            bowlerId: updated.id,
            squareCustomerId: updated.squareCustomerId
          });
          return sendSuccess(res, updated, 201);
        }
      } catch (squareError) {
        console.error('[Bowlers] Square sandbox API error:', squareError);
        // Continue with the created bowler even if Square integration fails
      }
    } else {
      console.log('[Bowlers] Skipping Square customer creation - no email provided');
    }

    sendSuccess(res, created, 201);
  } catch (error) {
    console.error('[Bowlers] Error creating bowler:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create bowler');
    }
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const update = partialBowlerSchema.parse(req.body);

    console.log(`[Bowlers] Updating bowler ${id}:`, update);

    const bowler = await storage.getBowler(id);
    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }
    
    // Check organization access
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToBowler(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to update this bowler", 403, 'FORBIDDEN');
      }
    }

    const updated = await storage.updateBowler(id, {
      ...bowler,
      ...update
    });
    console.log('[Bowlers] Bowler updated:', updated);
    sendSuccess(res, updated);
  } catch (error) {
    console.error('[Bowlers] Error updating bowler:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update bowler');
    }
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    console.log(`[Bowlers] Deleting bowler ${id}`);

    const bowler = await storage.getBowler(id);
    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }
    
    // Check organization access
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToBowler(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to delete this bowler", 403, 'FORBIDDEN');
      }
    }

    await storage.deleteBowler(id);
    console.log(`[Bowlers] Bowler ${id} deleted`);
    sendSuccess(res, null, 204);
  } catch (error) {
    console.error('[Bowlers] Error deleting bowler:', error);
    sendError(res,
      error instanceof Error ?
        `Failed to delete bowler: ${error.message}` :
        'Internal server error',
      500
    );
  }
});

export default router;