import { Router } from 'express';
import { storage } from '../storage.js';
import { insertTeamSchema, partialTeamSchema } from "@shared/schema.js";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api.js';

const router = Router();

router.get("/", async (req, res) => {
  try {
    const leagueId = req.query.leagueId ? parseInt(req.query.leagueId as string) : undefined;
    const teams = await storage.getTeams(leagueId);
    sendSuccess(res, teams);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch teams');
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const team = await storage.getTeam(id);
    if (!team) {
      return sendError(res, "Team not found", 404, 'NOT_FOUND');
    }
    sendSuccess(res, team);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch team');
  }
});

router.post("/", async (req, res) => {
  try {
    const team = insertTeamSchema.parse(req.body);
    const created = await storage.createTeam(team);
    sendSuccess(res, created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create team');
    }
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const update = partialTeamSchema.parse(req.body);
    const updated = await storage.updateTeam(id, update);
    sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update team');
    }
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteTeam(id);
    sendSuccess(res, null, 204);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to delete team');
  }
});

export default router;