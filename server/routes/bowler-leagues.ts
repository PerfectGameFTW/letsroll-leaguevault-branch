import { Router } from 'express';
import { storage } from '../storage';
import { insertBowlerLeagueSchema, partialBowlerLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

// Ensure JSON responses for all routes
router.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

router.get("/", async (req, res) => {
  try {
    const { bowlerId, leagueId, teamId } = req.query;
    console.log('[BowlerLeagues Route] Fetching with params:', { bowlerId, leagueId, teamId });

    const filters = {
      bowlerId: bowlerId ? parseInt(bowlerId as string) : undefined,
      leagueId: leagueId ? parseInt(leagueId as string) : undefined,
      teamId: teamId ? parseInt(teamId as string) : undefined
    };

    // Validate that we have valid numbers when params are provided
    if ((bowlerId && isNaN(filters.bowlerId!)) || 
        (leagueId && isNaN(filters.leagueId!)) || 
        (teamId && isNaN(filters.teamId!))) {
      return sendError(res, "Invalid ID parameters provided", 400, "INVALID_PARAMS");
    }

    const bowlerLeagues = await storage.getBowlerLeagues(filters);
    console.log(`[BowlerLeagues Route] Found ${bowlerLeagues.length} bowler leagues`);
    return sendSuccess(res, bowlerLeagues);
  } catch (error) {
    console.error('[BowlerLeagues Route] Error:', error);
    return sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowler leagues', 500);
  }
});

router.post("/", async (req, res) => {
  try {
    console.log('[BowlerLeagues Route] Creating new bowler league with body:', req.body);
    const data = insertBowlerLeagueSchema.parse(req.body);

    // Check if bowler is already in the league
    const existing = await storage.getBowlerLeagues({
      bowlerId: data.bowlerId,
      leagueId: data.leagueId,
    });

    if (existing.length > 0) {
      return sendError(res, "Bowler is already in this league", 400, "DUPLICATE_ENTRY");
    }

    const created = await storage.createBowlerLeague(data);
    console.log('[BowlerLeagues Route] Created bowler league:', created);
    return sendSuccess(res, created, 201);
  } catch (error) {
    console.error('[BowlerLeagues Route] Error creating bowler league:', error);
    if (error instanceof z.ZodError) {
      return sendError(res, error, 400, "VALIDATION_ERROR");
    }
    return sendError(res, error instanceof Error ? error.message : 'Failed to create bowler league', 500);
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid ID provided", 400, "INVALID_ID");
    }

    const update = partialBowlerLeagueSchema.parse(req.body);
    console.log(`[BowlerLeagues Route] Updating bowler league ${id}:`, update);

    // Handle order updates separately
    if (typeof update.order === 'number') {
      const bowlerLeague = await storage.getBowlerLeague(id);
      if (!bowlerLeague) {
        return sendError(res, "Bowler league not found", 404, "NOT_FOUND");
      }

      const updatedBowlerLeagues = await storage.updateBowlerLeagueOrder(id, update.order);
      console.log('[BowlerLeagues Route] Updated bowler league orders:', updatedBowlerLeagues);
      return sendSuccess(res, updatedBowlerLeagues);
    }

    // Handle other updates
    const updated = await storage.updateBowlerLeague(id, update);
    if (!updated) {
      return sendError(res, "Bowler league not found", 404, "NOT_FOUND");
    }
    return sendSuccess(res, updated);
  } catch (error) {
    console.error('[BowlerLeagues Route] Error updating bowler league:', error);
    if (error instanceof z.ZodError) {
      return sendError(res, error, 400, "VALIDATION_ERROR");
    }
    return sendError(res, error instanceof Error ? error.message : 'Failed to update bowler league', 500);
  }
});

export default router;