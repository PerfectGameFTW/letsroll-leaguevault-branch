import { Router } from 'express';
import { storage } from '../storage';
import { insertBowlerSchema, partialBowlerSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';
import { createOrUpdateCustomer } from '../services/square';

const router = Router();

router.get("/", async (req, res) => {
  try {
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
    const bowlers = await storage.getBowlers(teamId);
    sendSuccess(res, bowlers);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowlers');
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const bowler = await storage.getBowler(id);
    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }
    sendSuccess(res, bowler);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowler');
  }
});

router.post("/", async (req, res) => {
  try {
    const bowler = insertBowlerSchema.parse(req.body);

    const existingBowlers = await storage.getBowlers();
    const existingBowler = existingBowlers.find(b =>
      b.email.toLowerCase() === bowler.email.toLowerCase()
    );

    if (existingBowler) {
      return sendError(res, "A bowler with this email already exists", 400, 'DUPLICATE_EMAIL');
    }

    const created = await storage.createBowler(bowler);

    try {
      const squareCustomer = await createOrUpdateCustomer(created.name, created.email);
      if (squareCustomer) {
        const updated = await storage.updateBowler(created.id, { 
          squareCustomerId: squareCustomer.id 
        });
        return sendSuccess(res, updated, 201);
      }
    } catch (squareError) {
      console.error('Square API error:', squareError);
    }

    sendSuccess(res, created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create bowler');
    }
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const update = partialBowlerSchema.parse(req.body);

    const bowler = await storage.getBowler(id);
    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }

    const updated = await storage.updateBowler(id, update);
    sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, error, 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update bowler');
    }
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const bowler = await storage.getBowler(id);

    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }

    await storage.deleteBowler(id);
    sendSuccess(res, null, 204);
  } catch (error) {
    console.error('Error deleting bowler:', error);
    sendError(res,
      error instanceof Error ?
        `Failed to delete bowler: ${error.message}` :
        'Internal server error',
      500
    );
  }
});

export default router;