import { Router } from 'express';
import { sendSuccess, sendError } from '../utils/api.js';
import { isAllowedRedirectUrl } from '../utils/url-validation.js';
import { validateDataUri } from '../utils/image-magic-bytes.js';
import { storage } from '../storage';
import { createLogger } from '../logger';

const log = createLogger("OrganizationsPublic");

const router = Router();

router.get('/slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const organization = await storage.getOrganizationBySlug(slug);

    if (!organization) {
      return sendError(res, 'Organization not found', 404, 'NOT_FOUND');
    }

    sendSuccess(res, {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      darkLogo: organization.darkLogo,
      appIcon: organization.appIcon,
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
      return sendError(res, 'Organization not found', 404, 'NOT_FOUND');
    }

    const leagues = await storage.getLeagues(organization.id);
    const publicLeagues = leagues
      .filter(l => l.active !== false && l.allowPublicSignup === true)
      .map(l => ({ id: l.id, name: l.name }));
    sendSuccess(res, publicLeagues);
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
      const result = validateDataUri(logo);
      if (!result.valid) {
        return sendError(res, result.error, 400, 'INVALID_FORMAT');
      }
      res.set('Content-Type', result.mimeType);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(result.buffer);
    }

    if (!isAllowedRedirectUrl(logo)) {
      return sendError(res, 'Logo URL points to an untrusted domain', 400, 'UNTRUSTED_URL');
    }
    return res.redirect(logo);
  } catch (error) {
    log.error('Error serving organization logo:', error);
    sendError(res, 'Failed to serve logo', 500);
  }
});

router.get('/:id/app-icon', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid organization ID', 400, 'INVALID_ID');
    }
    const organization = await storage.getOrganization(id);
    const iconData = organization?.appIcon || organization?.logo;
    if (!organization || !iconData) {
      return sendError(res, 'App icon not found', 404, 'NOT_FOUND');
    }

    if (iconData.startsWith('data:')) {
      const result = validateDataUri(iconData);
      if (!result.valid) {
        return sendError(res, result.error, 400, 'INVALID_FORMAT');
      }
      res.set('Content-Type', result.mimeType);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(result.buffer);
    }

    if (!isAllowedRedirectUrl(iconData)) {
      return sendError(res, 'App icon URL points to an untrusted domain', 400, 'UNTRUSTED_URL');
    }
    return res.redirect(iconData);
  } catch (error) {
    log.error('Error serving organization app icon:', error);
    sendError(res, 'Failed to serve app icon', 500);
  }
});

export default router;
