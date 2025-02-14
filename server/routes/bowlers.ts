import { Router } from 'express';
import { storage } from '../storage.js';
import { insertBowlerSchema, partialBowlerSchema } from "@shared/schema.js";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api.js';
import { createOrUpdateCustomer } from '../services/square.js';

const router = Router();

router.get("/", async (req, res) => {
  try {
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
    const ids = req.query.ids ? (req.query.ids as string).split(',').map(id => parseInt(id)) : undefined;

    console.log('Fetching bowlers with params:', { teamId, ids });

    // Validate the teamId if provided
    if (teamId !== undefined && isNaN(teamId)) {
      return sendError(res, "Invalid team ID format", 400);
    }

    // Validate the ids if provided
    if (ids && ids.some(isNaN)) {
      return sendError(res, "Invalid bowler ID format in list", 400);
    }

    const bowlers = await storage.getBowlers(teamId);
    if (!bowlers) {
      console.log('No bowlers found');
      return sendSuccess(res, []);
    }

    // Filter by IDs if provided
    const filteredBowlers = ids 
      ? bowlers.filter(b => ids.includes(b.id))
      : bowlers;

    console.log(`Retrieved ${filteredBowlers.length} bowlers`);
    sendSuccess(res, filteredBowlers);
  } catch (error) {
    console.error('Error fetching bowlers:', error);
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
    console.error('Error fetching bowler:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowler');
  }
});

router.post("/", async (req, res) => {
  try {
    console.log('Creating new bowler:', req.body);
    const bowler = insertBowlerSchema.parse(req.body);

    // Check for existing bowler
    const existingBowlers = await storage.getBowlers();
    const existingBowler = (existingBowlers || []).find(b =>
      b.email.toLowerCase() === bowler.email.toLowerCase()
    );

    if (existingBowler) {
      console.log('Duplicate email found:', bowler.email);
      return sendError(res, "A bowler with this email already exists", 400, 'DUPLICATE_EMAIL');
    }

    // Create bowler in database first
    const created = await storage.createBowler(bowler);
    console.log('Bowler created in database:', created);

    // Then create Square customer
    try {
      const squareCustomer = await createOrUpdateCustomer(created.name, created.email);
      console.log('Square customer created:', squareCustomer);

      if (squareCustomer) {
        const updated = await storage.updateBowler(created.id, {
          squareCustomerId: squareCustomer.id,
          active: true // Ensure active status is set
        });
        console.log('Bowler updated with Square ID:', updated);
        return sendSuccess(res, updated, 201);
      }
    } catch (squareError) {
      console.error('Square API error:', squareError);
      // Continue with the created bowler even if Square integration fails
    }

    sendSuccess(res, created, 201);
  } catch (error) {
    console.error('Error creating bowler:', error);
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

    console.log(`Updating bowler ${id}:`, update);

    const bowler = await storage.getBowler(id);
    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }

    const updated = await storage.updateBowler(id, update);
    console.log('Bowler updated:', updated);
    sendSuccess(res, updated);
  } catch (error) {
    console.error('Error updating bowler:', error);
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
    console.log(`Deleting bowler ${id}`);

    const bowler = await storage.getBowler(id);
    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }

    await storage.deleteBowler(id);
    console.log(`Bowler ${id} deleted`);
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