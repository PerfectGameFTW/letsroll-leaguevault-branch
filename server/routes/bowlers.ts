import { Router } from 'express';
import { storage } from '../storage';
import { insertBowlerSchema, partialBowlerSchema, type Bowler } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';
import { createOrUpdateCustomer } from '../services/square';

const router = Router();

router.get("/", async (req, res) => {
  try {
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
    const bowlers = await storage.getBowlers(teamId);

    // Ensure proper filtering of active bowlers when teamId is provided
    const filteredBowlers = bowlers?.filter(bowler => 
      teamId ? bowler.active && bowler.teamId === teamId : bowler.active
    ) || [];

    console.log(`Retrieved ${filteredBowlers.length} bowlers for ${teamId ? `team ${teamId}` : 'all teams'}`);
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