import { Router } from 'express';
import { z } from 'zod';
import { sendSuccess, sendError } from '../utils/api.js';
import { storage } from '../storage.js';
import { insertLocationSchema, partialLocationSchema } from '@shared/schema.js';
import { filterByOrganization } from '../middleware/organization.js';

const router = Router();

router.get('/', filterByOrganization, async (req: any, res) => {
  try {
    const organizationId = req.organizationFilter;
    const locations = await storage.getLocations(organizationId);
    sendSuccess(res, locations);
  } catch (error) {
    console.error('Error fetching locations:', error);
    sendError(res, 'Failed to fetch locations', 500, 'ServerError');
  }
});

router.get('/:id', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');
    }

    const location = await storage.getLocation(id);
    if (!location) {
      return sendError(res, 'Location not found', 404, 'NotFound');
    }

    if (!req.user?.isAdmin && req.user?.organizationId !== location.organizationId) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    sendSuccess(res, location);
  } catch (error) {
    console.error(`Error fetching location with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to fetch location', 500, 'ServerError');
  }
});

router.post('/', async (req: any, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId && !req.user?.isAdmin) {
      return sendError(res, 'Organization required', 400, 'InvalidRequest');
    }

    const body = { ...req.body, organizationId: req.body.organizationId || organizationId };
    const validatedData = insertLocationSchema.parse(body);

    if (!req.user?.isAdmin && validatedData.organizationId !== organizationId) {
      return sendError(res, 'Cannot create location for another organization', 403, 'Forbidden');
    }

    const location = await storage.createLocation(validatedData);
    sendSuccess(res, location, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 'Invalid location data', 400, 'ValidationError');
    }
    console.error('Error creating location:', error);
    sendError(res, 'Failed to create location', 500, 'ServerError');
  }
});

router.patch('/:id', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');
    }

    const location = await storage.getLocation(id);
    if (!location) {
      return sendError(res, 'Location not found', 404, 'NotFound');
    }

    if (!req.user?.isAdmin && req.user?.organizationId !== location.organizationId) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    const validatedData = partialLocationSchema.parse(req.body);
    const cleanedData: Record<string, any> = {};
    for (const [key, value] of Object.entries(validatedData)) {
      if (value !== undefined && value !== null) {
        cleanedData[key] = value;
      }
    }
    const updatedLocation = await storage.updateLocation(id, cleanedData);
    sendSuccess(res, updatedLocation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 'Invalid location data', 400, 'ValidationError');
    }
    console.error(`Error updating location with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to update location', 500, 'ServerError');
  }
});

router.patch('/:id/archive', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');
    }

    const location = await storage.getLocation(id);
    if (!location) {
      return sendError(res, 'Location not found', 404, 'NotFound');
    }

    if (!req.user?.isAdmin && req.user?.organizationId !== location.organizationId) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    const archived = await storage.archiveLocation(id);
    sendSuccess(res, archived);
  } catch (error) {
    console.error(`Error archiving location with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to archive location', 500, 'ServerError');
  }
});

router.patch('/:id/restore', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');
    }

    const location = await storage.getLocation(id);
    if (!location) {
      return sendError(res, 'Location not found', 404, 'NotFound');
    }

    if (!req.user?.isAdmin && req.user?.organizationId !== location.organizationId) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    const restored = await storage.restoreLocation(id);
    sendSuccess(res, restored);
  } catch (error) {
    console.error(`Error restoring location with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to restore location', 500, 'ServerError');
  }
});

router.delete('/:id', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid location ID', 400, 'InvalidRequest');
    }

    const location = await storage.getLocation(id);
    if (!location) {
      return sendError(res, 'Location not found', 404, 'NotFound');
    }

    if (!req.user?.isAdmin && req.user?.organizationId !== location.organizationId) {
      return sendError(res, 'You do not have access to this location', 403, 'Forbidden');
    }

    await storage.deleteLocation(id);
    sendSuccess(res, { message: 'Location deleted successfully' });
  } catch (error) {
    console.error(`Error deleting location with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to delete location', 500, 'ServerError');
  }
});

export default router;
