import { Router } from 'express';
import { storage } from '../storage';
import { insertBowlerLeagueSchema, partialBowlerLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

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
    const update = partialBowlerLeagueSchema.parse(req.body);

    // Handle order updates separately from other updates
    if (typeof update.order === 'number') {
      console.log(`Updating bowler league ${id} order to ${update.order}`);
      const bowlerLeague = await storage.getBowlerLeague(id);
      if (!bowlerLeague) {
        return sendError(res, "Bowler league not found", 404, 'NOT_FOUND');
      }

      const updatedBowlerLeagues = await storage.updateBowlerLeagueOrder(id, update.order);
      console.log('Updated bowler league orders:', JSON.stringify(updatedBowlerLeagues, null, 2));
      return sendSuccess(res, updatedBowlerLeagues);
    }

    // Handle other updates
    const updated = await storage.updateBowlerLeague(id, update);
    sendSuccess(res, updated);
  } catch (error) {
    console.error('Error updating bowler league:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update bowler league');
    }
  }
});

router.post("/", async (req, res) => {
  try {
    const association = insertBowlerLeagueSchema.parse(req.body);
    const created = await storage.createBowlerLeague(association);
    sendSuccess(res, created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create bowler league');
    }
  }
});

export default router;