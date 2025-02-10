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

    const filters = {
      bowlerId: bowlerId ? parseInt(bowlerId as string) : undefined,
      leagueId: leagueId ? parseInt(leagueId as string) : undefined,
      teamId: teamId ? parseInt(teamId as string) : undefined
    };

    const bowlerLeagues = await storage.getBowlerLeagues(filters);
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

    // Handle order updates separately from other updates
    if (typeof update.order === 'number') {
      console.log(`Updating bowler league ${id} order to ${update.order}`);
      const updatedBowlerLeagues = await storage.updateBowlerLeagueOrder(id, update.order);
      console.log('Updated bowler league orders:', updatedBowlerLeagues);
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