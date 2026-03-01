import { Router } from 'express';
import { storage } from '../storage.js';
import { insertBowlerSchema, partialBowlerSchema } from "@shared/schema.js";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api.js';
import { createOrUpdateCustomer } from '../services/square.js';
import { hasAccessToTeam, hasAccessToBowler } from '../utils/access-control.js';

const router = Router();

router.get("/", async (req, res) => {
  try {
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
    const ids = req.query.ids ? (req.query.ids as string).split(',').map(id => parseInt(id)) : undefined;

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
      return sendSuccess(res, []);
    }

    // If no teamId provided, we need to filter bowlers by organization
    let accessibleBowlers = bowlers;
    
    if (!teamId && !req.user?.isAdmin && req.user?.organizationId) {
      const [leagues, bowlerLeagues] = await Promise.all([
        storage.getLeagues(req.user.organizationId),
        storage.getBowlerLeagues(),
      ]);

      if (!leagues || leagues.length === 0) {
        return sendSuccess(res, []);
      }

      const leagueIdSet = new Set(leagues.map(l => l.id));
      const organizationBowlerIds = new Set(
        bowlerLeagues
          .filter(bl => leagueIdSet.has(bl.leagueId))
          .map(bl => bl.bowlerId)
      );

      accessibleBowlers = bowlers.filter(b => organizationBowlerIds.has(b.id));
    }

    // Filter by IDs if provided
    const filteredBowlers = ids 
      ? accessibleBowlers.filter(b => ids.includes(b.id))
      : accessibleBowlers;

    sendSuccess(res, filteredBowlers);
  } catch (error) {
    console.error('[Bowlers] Error fetching bowlers:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowlers');
  }
});

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
        const [leagues, bowlerLeagues] = await Promise.all([
          storage.getLeagues(req.user.organizationId),
          storage.getBowlerLeagues(),
        ]);
        if (leagues && leagues.length > 0) {
          const leagueIdSet = new Set(leagues.map(l => l.id));
          const organizationBowlerIds = new Set(
            bowlerLeagues
              .filter(bl => leagueIdSet.has(bl.leagueId))
              .map(bl => bl.bowlerId)
          );
          filteredBowlers = existingBowlers.filter(b => organizationBowlerIds.has(b.id));
        }
      }
      
      const existingBowler = filteredBowlers.find(b =>
        b.email && b.email.toLowerCase() === bowler.email.toLowerCase()
      );

      if (existingBowler) {
        return sendError(res, "A bowler with this email already exists", 400, 'DUPLICATE_EMAIL');
      }
    }

    // Create bowler in database first
    const created = await storage.createBowler(bowler);

    if (created.email) {
      try {
        const squareCustomer = await createOrUpdateCustomer(created.name, created.email);

        if (squareCustomer) {
          const updated = await storage.updateBowler(created.id, {
            ...created,
            squareCustomerId: squareCustomer.id,
            active: true
          });
          return sendSuccess(res, updated, 201);
        }
      } catch (squareError) {
        console.error('[Bowlers] Square API error:', squareError);
      }
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