import { Router } from 'express';
import { storage } from '../storage';
import { insertBowlerLeagueSchema, partialBowlerLeagueSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

// Error handling middleware specific to bowler-leagues
router.use((err: any, req: any, res: any, next: any) => {
  console.error('[BowlerLeagues] Error:', err);
  res.json({
    success: false,
    error: err.message || 'An unexpected error occurred'
  });
});

router.get("/", async (req, res) => {
  try {
    const { bowlerId, leagueId, teamId } = req.query;
    console.log('[BowlerLeagues] Fetching with params:', { bowlerId, leagueId, teamId });

    const filters = {
      bowlerId: bowlerId ? parseInt(bowlerId as string) : undefined,
      leagueId: leagueId ? parseInt(leagueId as string) : undefined,
      teamId: teamId ? parseInt(teamId as string) : undefined
    };

    // Validate that we have valid numbers when params are provided
    if ((bowlerId && isNaN(filters.bowlerId!)) || 
        (leagueId && isNaN(filters.leagueId!)) || 
        (teamId && isNaN(filters.teamId!))) {
      return res.json({ 
        success: false, 
        error: "Invalid ID parameters provided" 
      });
    }

    const bowlerLeagues = await storage.getBowlerLeagues(filters);
    console.log(`[BowlerLeagues] Found ${bowlerLeagues.length} bowler leagues`);
    return res.json({
      success: true,
      data: bowlerLeagues
    });
  } catch (error) {
    console.error('[BowlerLeagues] Error:', error);
    return res.json({ // This catch block is now redundant but kept for additional logging
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch bowler leagues'
    });
  }
});

router.post("/", async (req, res) => {
  try {
    console.log('[BowlerLeagues] Creating new bowler league with body:', req.body);
    const data = insertBowlerLeagueSchema.parse(req.body);

    // Check if bowler is already in the league
    const existing = await storage.getBowlerLeagues({
      bowlerId: data.bowlerId,
      leagueId: data.leagueId
    });

    if (existing.length > 0) {
      return res.json({
        success: false,
        error: "Bowler is already in this league"
      });
    }

    const created = await storage.createBowlerLeague(data);
    console.log('[BowlerLeagues] Created bowler league:', created);
    return res.json({
      success: true,
      data: created
    });
  } catch (error) {
    console.error('[BowlerLeagues] Error creating bowler league:', error);
    return res.json({ //This catch block is now redundant but kept for additional logging
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create bowler league'
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.json({
        success: false,
        error: "Invalid ID provided"
      });
    }

    const update = partialBowlerLeagueSchema.parse(req.body);
    console.log(`[BowlerLeagues] Updating bowler league ${id}:`, update);

    const updated = await storage.updateBowlerLeague(id, update);
    if (!updated) {
      return res.json({
        success: false,
        error: "Bowler league not found"
      });
    }
    return res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    console.error('[BowlerLeagues] Error updating bowler league:', error);
    return res.json({ //This catch block is now redundant but kept for additional logging
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update bowler league'
    });
  }
});

export default router;