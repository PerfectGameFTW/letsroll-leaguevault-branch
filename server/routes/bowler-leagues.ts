import { Router } from 'express';
import { storage } from '../storage';
import { insertBowlerLeagueSchema, partialBowlerLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

// Middleware to ensure JSON responses
router.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

router.get("/", async (req, res) => {
  try {
    const { bowlerId, leagueId, teamId } = req.query;
    console.log('[BowlerLeagues Router] Fetching with params:', { bowlerId, leagueId, teamId });

    const filters = {
      bowlerId: bowlerId ? parseInt(bowlerId as string) : undefined,
      leagueId: leagueId ? parseInt(leagueId as string) : undefined,
      teamId: teamId ? parseInt(teamId as string) : undefined
    };

    // Validate that we have valid numbers when params are provided
    if ((bowlerId && isNaN(filters.bowlerId!)) || 
        (leagueId && isNaN(filters.leagueId!)) || 
        (teamId && isNaN(filters.teamId!))) {
      return sendError(res, "Invalid ID parameters provided", 400);
    }

    const bowlerLeagues = await storage.getBowlerLeagues(filters);
    console.log(`[BowlerLeagues Router] Found ${bowlerLeagues.length} bowler leagues`);
    sendSuccess(res, bowlerLeagues);
  } catch (error) {
    console.error('[BowlerLeagues Router] Error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowler leagues');
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid ID provided", 400);
    }

    const update = partialBowlerLeagueSchema.parse(req.body);

    // Handle order updates separately from other updates
    if (typeof update.order === 'number') {
      console.log(`[BowlerLeagues Router] Updating bowler league ${id} order to ${update.order}`);
      const bowlerLeague = await storage.getBowlerLeague(id);
      if (!bowlerLeague) {
        return sendError(res, "Bowler league not found", 404);
      }

      const updatedBowlerLeagues = await storage.updateBowlerLeagueOrder(id, update.order);
      console.log('[BowlerLeagues Router] Updated bowler league orders:', updatedBowlerLeagues);
      return sendSuccess(res, updatedBowlerLeagues);
    }

    // Handle other updates
    const updated = await storage.updateBowlerLeague(id, update);
    sendSuccess(res, updated);
  } catch (error) {
    console.error('[BowlerLeagues Router] Error updating bowler league:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update bowler league');
    }
  }
});

router.post("/", async (req, res) => {
  try {
    console.log('[BowlerLeagues Router] Creating new bowler league with body:', req.body);
    const association = insertBowlerLeagueSchema.parse(req.body);
    const created = await storage.createBowlerLeague(association);
    console.log('[BowlerLeagues Router] Created bowler league:', created);
    sendSuccess(res, created, 201);
  } catch (error) {
    console.error('[BowlerLeagues Router] Error creating bowler league:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create bowler league');
    }
  }
});

export default router;