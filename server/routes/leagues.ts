import { Router } from 'express';
import { storage } from '../storage';
import { insertLeagueSchema, partialLeagueSchema } from "@shared/schema"; // Added import for partialLeagueSchema
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const leagues = await storage.getLeagues();
    sendSuccess(res, leagues);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch leagues');
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const league = await storage.getLeague(id);
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    sendSuccess(res, league);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch league');
  }
});

router.post("/", async (req, res) => {
  try {
    const league = insertLeagueSchema.parse(req.body);
    const created = await storage.createLeague(league);
    sendSuccess(res, created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create league');
    }
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const update = partialLeagueSchema.parse(req.body);
    const updated = await storage.updateLeague(id, update);
    sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update league');
    }
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const teams = await storage.getTeams(id);

    for (const team of teams) {
      const teamBowlers = await storage.getBowlers(team.id);
      for (const bowler of teamBowlers) {
        await storage.updateBowler(bowler.id, { active: false, order: 0 });
      }
      await storage.deleteTeam(team.id);
    }

    await storage.deleteLeague(id);
    sendSuccess(res, null, 204);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to delete league');
  }
});

export default router;