import { Router } from 'express';
import { storage } from '../storage';
import { insertBowlerLeagueSchema, partialBowlerLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { bowlerId, leagueId, teamId } = req.query;
    console.log('Fetching bowler leagues with params:', { bowlerId, leagueId, teamId });
    
    const bowlerLeagues = await storage.getBowlerLeagues(
      bowlerId ? parseInt(bowlerId as string) : undefined,
      leagueId ? parseInt(leagueId as string) : undefined,
      teamId ? parseInt(teamId as string) : undefined
    );

    console.log(`Found ${bowlerLeagues.length} bowler leagues`);
    sendSuccess(res, bowlerLeagues);
  } catch (error) {
    console.error('Error fetching bowler leagues:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowler leagues');
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const update = partialBowlerLeagueSchema.parse(req.body);
    
    if (typeof update.order === 'number') {
      const updatedBowlerLeagues = await storage.updateBowlerLeagueOrder(id, update.order);
      console.log('Updated bowler league order:', updatedBowlerLeagues);
      return sendSuccess(res, updatedBowlerLeagues);
    }
    
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

export default router;
