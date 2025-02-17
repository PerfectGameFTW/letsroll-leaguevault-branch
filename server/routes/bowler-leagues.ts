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
      return res.status(400).json({
        success: false,
        error: { message: "Invalid ID parameters provided" }
      });
    }

    const bowlerLeagues = await storage.getBowlerLeagues(filters);
    console.log(`[BowlerLeagues] Found ${bowlerLeagues.length} bowler leagues for filters:`, filters);
    return res.json({ success: true, data: bowlerLeagues });
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Failed to fetch bowler leagues' }
    });
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
      return res.status(400).json({
        success: false,
        error: { message: "Bowler is already in this league" }
      });
    }

    const created = await storage.createBowlerLeague(data);
    console.log('[BowlerLeagues] Created bowler league:', created);
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: { message: "Validation error", details: error.errors }
      });
    } else {
      return res.status(500).json({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Failed to create bowler league' }
      });
    }
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { message: "Invalid ID provided" }
      });
    }

    const update = partialBowlerLeagueSchema.parse(req.body);
    console.log(`[BowlerLeagues] Updating bowler league ${id}:`, update);

    const updated = await storage.updateBowlerLeague(id, update);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: { message: "Bowler league not found" }
      });
    }
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: { message: "Validation error", details: error.errors }
      });
    } else {
      return res.status(500).json({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Failed to update bowler league' }
      });
    }
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { message: "Invalid ID provided" }
      });
    }

    console.log(`[BowlerLeagues] Deleting bowler league ${id}`);
    const deleted = await storage.deleteBowlerLeague(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: { message: "Bowler league not found" }
      });
    }

    console.log(`[BowlerLeagues] Successfully deleted bowler league ${id}`);
    return res.json({
      success: true,
      data: { message: "Bowler league deleted successfully" }
    });
  } catch (error) {
    console.error('[BowlerLeagues] Error deleting bowler league:', error);
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Failed to delete bowler league' }
    });
  }
});

router.patch("/:id/order", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { newOrder } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: { message: "Invalid bowler league ID" }
      });
    }

    if (typeof newOrder !== 'number') {
      return res.status(400).json({
        success: false,
        error: { message: "New order must be a number" }
      });
    }

    const updated = await storage.updateBowlerLeagueOrder(id, newOrder);
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    return res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Failed to update bowler league order' }
    });
  }
});

export default router;