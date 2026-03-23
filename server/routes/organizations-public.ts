import { Router } from 'express';
import { sendSuccess, sendError } from '../utils/api.js';
import { storage } from '../storage';
import { createLogger } from '../logger';

const log = createLogger("OrganizationsPublic");

const router = Router();

router.get('/slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const organization = await storage.getOrganizationBySlug(slug);

    if (!organization) {
      return sendError(res, 'Organization not found', 404, 'NotFound');
    }

    sendSuccess(res, {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      darkLogo: organization.darkLogo,
    });
  } catch (error) {
    log.error(`Error fetching organization with slug ${req.params.slug}:`, error);
    sendError(res, 'Failed to fetch organization', 500, 'ServerError');
  }
});

router.get('/slug/:slug/leagues', async (req, res) => {
  try {
    const { slug } = req.params;
    const organization = await storage.getOrganizationBySlug(slug);

    if (!organization) {
      return sendError(res, 'Organization not found', 404, 'NotFound');
    }

    const leagues = await storage.getLeagues(organization.id);
    const activeLeagues = leagues.filter(l => l.active !== false);
    sendSuccess(res, activeLeagues);
  } catch (error) {
    log.error(`Error fetching leagues for org slug ${req.params.slug}:`, error);
    sendError(res, 'Failed to fetch organization leagues', 500, 'ServerError');
  }
});

router.get('/:id/logo', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid organization ID', 400, 'INVALID_ID');
    }
    const organization = await storage.getOrganization(id);
    if (!organization || !organization.logo) {
      return sendError(res, 'Logo not found', 404, 'NOT_FOUND');
    }

    const logo = organization.logo;
    if (logo.startsWith('data:')) {
      const matches = logo.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        return sendError(res, 'Invalid logo format', 400, 'INVALID_FORMAT');
      }
      const mimeType = matches[1];
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedMimeTypes.includes(mimeType)) {
        return sendError(res, 'Invalid logo MIME type', 400, 'INVALID_MIME_TYPE');
      }
      const buffer = Buffer.from(matches[2], 'base64');
      res.set('Content-Type', mimeType);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buffer);
    }

    return res.redirect(logo);
  } catch (error) {
    log.error('Error serving organization logo:', error);
    sendError(res, 'Failed to serve logo', 500);
  }
});

export default router;
