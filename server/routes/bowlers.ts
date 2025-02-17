import { Router } from 'express';
import { storage } from '../storage.js';
import { insertBowlerSchema, partialBowlerSchema } from "@shared/schema.js";
import { z } from "zod";
import { createOrUpdateCustomer } from '../services/square.js';

const router = Router();

router.get("/", async (req, res) => {
  try {
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
    const ids = req.query.ids ? (req.query.ids as string).split(',').map(id => parseInt(id)) : undefined;

    console.log('Fetching bowlers with params:', { teamId, ids });

    // Validate the teamId if provided
    if (teamId !== undefined && isNaN(teamId)) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Invalid team ID format"
        }
      });
    }

    // Validate the ids if provided
    if (ids && ids.some(isNaN)) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Invalid bowler ID format in list"
        }
      });
    }

    const bowlers = await storage.getBowlers(teamId);
    if (!bowlers) {
      console.log('No bowlers found');
      return res.json({ success: true, data: [] });
    }

    // Filter by IDs if provided
    const filteredBowlers = ids 
      ? bowlers.filter(b => ids.includes(b.id))
      : bowlers;

    console.log(`Retrieved ${filteredBowlers.length} bowlers`);
    return res.json({ success: true, data: filteredBowlers });
  } catch (error) {
    console.error('Error fetching bowlers:', error);
    return res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to fetch bowlers'
      }
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const bowler = await storage.getBowler(id);
    if (!bowler) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Bowler not found",
          code: 'NOT_FOUND'
        }
      });
    }
    return res.json({ success: true, data: bowler });
  } catch (error) {
    console.error('Error fetching bowler:', error);
    return res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to fetch bowler'
      }
    });
  }
});

router.post("/", async (req, res) => {
  try {
    console.log('Creating new bowler:', req.body);
    const bowler = insertBowlerSchema.parse(req.body);

    // Check for existing bowler
    const existingBowlers = await storage.getBowlers();
    const existingBowler = (existingBowlers || []).find(b =>
      b.email?.toLowerCase() === bowler.email?.toLowerCase()
    );

    if (existingBowler) {
      console.log('Duplicate email found:', bowler.email);
      return res.status(400).json({
        success: false,
        error: {
          message: "A bowler with this email already exists",
          code: 'DUPLICATE_EMAIL'
        }
      });
    }

    // Create bowler in database first
    const created = await storage.createBowler(bowler);
    console.log('Bowler created in database:', created);

    // Then create Square customer if email is provided
    if (bowler.email) {
      try {
        const squareCustomer = await createOrUpdateCustomer(created.name, bowler.email);
        console.log('Square customer created:', squareCustomer);

        if (squareCustomer) {
          const updated = await storage.updateBowler(created.id, {
            squareCustomerId: squareCustomer.id,
            active: true
          });
          console.log('Bowler updated with Square ID:', updated);
          return res.status(201).json({ success: true, data: updated });
        }
      } catch (squareError) {
        console.error('Square API error:', squareError);
        // Continue with the created bowler even if Square integration fails
      }
    }

    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Error creating bowler:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: { message: "Validation error", details: error.errors }
      });
    } else {
      return res.status(500).json({
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Failed to create bowler'
        }
      });
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
      return res.status(404).json({
        success: false,
        error: {
          message: "Bowler not found",
          code: 'NOT_FOUND'
        }
      });
    }

    const updated = await storage.updateBowler(id, update);
    console.log('Bowler updated:', updated);
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating bowler:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: { message: "Validation error", details: error.errors }
      });
    } else {
      return res.status(500).json({
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Failed to update bowler'
        }
      });
    }
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    console.log(`Deleting bowler ${id}`);

    const bowler = await storage.getBowler(id);
    if (!bowler) {
      return res.status(404).json({
        success: false,
        error: {
          message: "Bowler not found",
          code: 'NOT_FOUND'
        }
      });
    }

    await storage.deleteBowler(id);
    console.log(`Bowler ${id} deleted`);
    return res.sendStatus(204);
  } catch (error) {
    console.error('Error deleting bowler:', error);
    return res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? 
          `Failed to delete bowler: ${error.message}` :
          'Internal server error'
      }
    });
  }
});

export default router;