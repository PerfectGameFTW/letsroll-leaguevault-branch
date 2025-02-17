import { Router } from 'express';
import { storage } from '../storage';
import { insertBowlerLeagueSchema, partialBowlerLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { bowlerId, leagueId, teamId } = req.query;
    console.log('[BowlerLeagues] Fetching with params:', { bowlerId, leagueId, teamId });

    const filters = {
      bowlerId: bowlerId ? parseInt(bowlerId as string) : undefined,
      leagueId: leagueId ? parseInt(leagueId as string) : undefined,
      teamId: teamId ? parseInt(teamId as string) : undefined
    };

    // Validate that all provided IDs are valid numbers
    if ((bowlerId && isNaN(filters.bowlerId!)) || 
        (leagueId && isNaN(filters.leagueId!)) || 
        (teamId && isNaN(filters.teamId!))) {
      return sendError(res, "Invalid ID parameters provided", 400);
    }

    const bowlerLeagues = await storage.getBowlerLeagues(filters);
    console.log(`[BowlerLeagues] Found ${bowlerLeagues.length} bowler leagues for filters:`, filters);
    sendSuccess(res, bowlerLeagues);
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowler leagues');
  }
});

router.post("/", async (req, res) => {
  try {
    console.log('[BowlerLeagues] Creating new bowler league with body:', req.body);
    const data = insertBowlerLeagueSchema.parse(req.body);

    const existing = await storage.getBowlerLeagues({
      bowlerId: data.bowlerId,
      leagueId: data.leagueId
    });

    if (existing.length > 0) {
      return sendError(res, "Bowler is already in this league", 400);
    }

    const created = await storage.createBowlerLeague(data);
    console.log('[BowlerLeagues] Created bowler league:', created);
    sendSuccess(res, created, 201);
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    if (error instanceof z.ZodError) {
      sendError(res, "Validation error", 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create bowler league');
    }
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid ID provided");
    }

    const update = partialBowlerLeagueSchema.parse(req.body);
    console.log(`[BowlerLeagues] Updating bowler league ${id}:`, update);

    const updated = await storage.updateBowlerLeague(id, update);
    if (!updated) {
      return sendError(res, "Bowler league not found", 404);
    }
    sendSuccess(res, updated);
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    if (error instanceof z.ZodError) {
      sendError(res, "Validation error", 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update bowler league');
    }
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid ID provided", 400);
    }

    console.log(`[BowlerLeagues] Deleting bowler league ${id}`);
    const deleted = await storage.deleteBowlerLeague(id);

    if (!deleted) {
      return sendError(res, "Bowler league not found", 404);
    }

    console.log(`[BowlerLeagues] Successfully deleted bowler league ${id}`);
    sendSuccess(res, { message: "Bowler league deleted successfully" }, 200);
  } catch (error) {
    console.error('[BowlerLeagues] Error deleting bowler league:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to delete bowler league');
  }
});

router.patch("/:id/order", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { newOrder } = req.body;

    if (isNaN(id)) {
      return sendError(res, "Invalid bowler league ID", 400);
    }

    if (typeof newOrder !== 'number') {
      return sendError(res, "New order must be a number", 400);
    }

    const updated = await storage.updateBowlerLeagueOrder(id, newOrder);
    sendSuccess(res, updated);
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to update bowler league order');
  }
});

export default router;