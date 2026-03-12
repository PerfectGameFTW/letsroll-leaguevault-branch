import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { sendSuccess, sendError, sanitizeUser } from '../utils/api.js';
import { storage } from '../storage.js';
import { 
  insertOrganizationSchema, 
  partialOrganizationSchema, 
  users,
  type InsertOrganization,
  type Organization
} from '@shared/schema.js';
import { requireAdmin } from '../middleware/admin.js';
import { hashPassword } from '../auth.js';
import { requireOrganizationAccess } from '../utils/access-control.js';
import { sendTemplatedEmail, getBaseUrl, getOrgLogoUrl } from '../services/email.js';

const router = Router();

// Get all organizations (admin only)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const organizations = await storage.getOrganizations();
    sendSuccess(res, organizations);
  } catch (error) {
    console.error('Error fetching organizations:', error);
    sendError(res, 'Failed to fetch organizations', 500, 'ServerError');
  }
});

router.get('/:id/logo', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).send('Invalid organization ID');
    }
    const organization = await storage.getOrganization(id);
    if (!organization || !organization.logo) {
      return res.status(404).send('Logo not found');
    }

    const logo = organization.logo;
    if (logo.startsWith('data:')) {
      const matches = logo.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).send('Invalid logo format');
      }
      const mimeType = matches[1];
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedMimeTypes.includes(mimeType)) {
        return res.status(400).send('Invalid logo MIME type');
      }
      const buffer = Buffer.from(matches[2], 'base64');
      res.set('Content-Type', mimeType);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buffer);
    }

    return res.redirect(logo);
  } catch (error) {
    console.error('Error serving organization logo:', error);
    res.status(500).send('Failed to serve logo');
  }
});

// Get an organization by ID (admin only)
router.get('/:id', async (req: any, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid organization ID', 400, 'InvalidRequest');
    }

    if (!requireOrganizationAccess(req, id)) {
      return sendError(res, 'You do not have access to this organization', 403, 'Forbidden');
    }

    const organization = await storage.getOrganization(id);
    if (!organization) {
      return sendError(res, 'Organization not found', 404, 'NotFound');
    }

    sendSuccess(res, organization);
  } catch (error) {
    console.error(`Error fetching organization with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to fetch organization', 500, 'ServerError');
  }
});

// Check if a slug is available
router.get('/check-slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    // Validate slug format
    const slugRegex = /^[a-z0-9-]+$/;
    if (!slugRegex.test(slug)) {
      return sendError(res, 'Invalid slug format. Use only lowercase letters, numbers, and hyphens.', 400, 'INVALID_FORMAT');
    }
    
    const organization = await storage.getOrganizationBySlug(slug);
    
    // Return the availability status
    sendSuccess(res, { 
      slug,
      available: !organization,
      message: organization ? 'Slug is already in use' : 'Slug is available'
    });
  } catch (error) {
    console.error(`[Organizations] Error checking slug availability for ${req.params.slug}:`, error);
    sendError(res, 'Failed to check slug availability', 500, 'SERVER_ERROR');
  }
});

// Get organization public info by slug (no auth required — used by sign-up page)
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
    });
  } catch (error) {
    console.error(`Error fetching organization with slug ${req.params.slug}:`, error);
    sendError(res, 'Failed to fetch organization', 500, 'ServerError');
  }
});

// Get leagues for an organization by slug (public — used by sign-up page)
router.get('/slug/:slug/leagues', async (req, res) => {
  try {
    const { slug } = req.params;
    const organization = await storage.getOrganizationBySlug(slug);
    
    if (!organization) {
      return sendError(res, 'Organization not found', 404, 'NotFound');
    }

    const leagues = await storage.getOrganizationLeagues(organization.id);
    const activeLeagues = leagues.filter(l => l.active !== false);
    sendSuccess(res, activeLeagues);
  } catch (error) {
    console.error(`Error fetching leagues for org slug ${req.params.slug}:`, error);
    sendError(res, 'Failed to fetch organization leagues', 500, 'ServerError');
  }
});

// Create a new organization (admin only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { adminData, ...orgData } = req.body;
    const validatedData = insertOrganizationSchema.parse(orgData);
    
    // Check if organization with slug already exists
    const existingOrg = await storage.getOrganizationBySlug(validatedData.slug);
    if (existingOrg) {
      return sendError(res, 'An organization with this slug already exists', 409, 'Conflict');
    }

    const organization = await storage.createOrganization(validatedData);
    
    if (adminData && adminData.email && adminData.name) {
      try {
        const existingUser = await storage.getUserByEmail(adminData.email);
        if (existingUser) {
          if (!existingUser.isOrganizationAdmin) {
            await storage.updateUserOrganizationAdminStatus(existingUser.id, true);
          }
          await storage.setUserOrganization(existingUser.id, organization.id);
          return sendSuccess(res, { organization, adminUser: sanitizeUser(existingUser) }, 201);
        }
        
        const placeholderPassword = await hashPassword(randomBytes(32).toString('hex'));
        const newAdminUser = await storage.createUser({
          email: adminData.email,
          name: adminData.name,
          password: placeholderPassword,
          phone: adminData.phone || null,
          isAdmin: false,
          isOrganizationAdmin: true,
          organizationId: organization.id
        });

        const inviteToken = randomBytes(32).toString('hex');
        const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await storage.setUserInviteToken(newAdminUser.id, inviteToken, inviteTokenExpiry);

        const firstName = adminData.name.split(' ')[0];
        const baseUrl = getBaseUrl();
        const setupUrl = `${baseUrl}/set-password?token=${inviteToken}`;
        const variables: Record<string, string> = {
          admin_name: firstName,
          invite_link: setupUrl,
          organization_name: organization.name,
          organization_logo_url: getOrgLogoUrl(organization.id),
        };
        await sendTemplatedEmail('org_admin_invite', adminData.email, variables);
        
        return sendSuccess(res, { organization, adminUser: sanitizeUser(newAdminUser) }, 201);
      } catch (adminError) {
        console.error('[Organizations] Error creating admin user:', adminError);
        return sendSuccess(res, { 
          organization, 
          warning: 'Organization created but there was an error creating the admin user'
        }, 201);
      }
    }

    sendSuccess(res, organization, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 'Invalid organization data', 400, 'ValidationError');
    }
    console.error('Error creating organization:', error);
    sendError(res, 'Failed to create organization', 500, 'ServerError');
  }
});

// Update an organization (admin only)
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid organization ID', 400, 'InvalidRequest');
    }

    const organization = await storage.getOrganization(id);
    if (!organization) {
      return sendError(res, 'Organization not found', 404, 'NotFound');
    }

    const validatedData = partialOrganizationSchema.parse(req.body);
    
    // If slug is being updated, check if it's already in use
    if (validatedData.slug && validatedData.slug !== organization.slug) {
      const existingOrg = await storage.getOrganizationBySlug(validatedData.slug);
      if (existingOrg && existingOrg.id !== id) {
        return sendError(res, 'An organization with this slug already exists', 409, 'Conflict');
      }
    }

    // Create a strongly typed object with the correct fields
    // This ensures null fields are converted to undefined for the storage interface
    const formattedData: Partial<InsertOrganization> = {
      name: validatedData.name,
      slug: validatedData.slug,
      active: validatedData.active,
      address: validatedData.address === null ? undefined : validatedData.address,
      city: validatedData.city === null ? undefined : validatedData.city,
      state: validatedData.state === null ? undefined : validatedData.state,
      zipCode: validatedData.zipCode === null ? undefined : validatedData.zipCode,
      phone: validatedData.phone === null ? undefined : validatedData.phone,
      email: validatedData.email === null ? undefined : validatedData.email,
      logo: validatedData.logo === null ? undefined : validatedData.logo
    };

    // Filter out undefined values to avoid sending unnecessary fields
    const cleanedData = Object.fromEntries(
      Object.entries(formattedData).filter(([_, value]) => value !== undefined)
    ) as Partial<InsertOrganization>;

    const updatedOrganization = await storage.updateOrganization(id, cleanedData);
    sendSuccess(res, updatedOrganization);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 'Invalid organization data', 400, 'ValidationError');
    }
    console.error(`Error updating organization with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to update organization', 500, 'ServerError');
  }
});

// Archive an organization (admin only)
router.patch('/:id/archive', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid organization ID', 400, 'InvalidRequest');
    }

    const organization = await storage.getOrganization(id);
    if (!organization) {
      return sendError(res, 'Organization not found', 404, 'NotFound');
    }

    const archived = await storage.archiveOrganization(id);
    sendSuccess(res, archived);
  } catch (error) {
    console.error(`Error archiving organization with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to archive organization', 500, 'ServerError');
  }
});

// Restore an archived organization (admin only)
router.patch('/:id/restore', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid organization ID', 400, 'InvalidRequest');
    }

    const organization = await storage.getOrganization(id);
    if (!organization) {
      return sendError(res, 'Organization not found', 404, 'NotFound');
    }

    const restored = await storage.restoreOrganization(id);
    sendSuccess(res, restored);
  } catch (error) {
    console.error(`Error restoring organization with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to restore organization', 500, 'ServerError');
  }
});

// Delete an organization permanently (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid organization ID', 400, 'InvalidRequest');
    }

    const organization = await storage.getOrganization(id);
    if (!organization) {
      return sendError(res, 'Organization not found', 404, 'NotFound');
    }

    await storage.deleteOrganization(id);
    sendSuccess(res, { message: 'Organization deleted successfully' });
  } catch (error) {
    console.error(`Error deleting organization with ID ${req.params.id}:`, error);
    sendError(res, 'Failed to delete organization', 500, 'ServerError');
  }
});

// Get current user's organizations
router.get('/user/me', async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return sendError(res, 'Authentication required', 401, 'Unauthorized');
    }

    const organizations = await storage.getUserOrganizations(req.user.id);
    sendSuccess(res, organizations);
  } catch (error) {
    console.error('Error fetching user organizations:', error);
    sendError(res, 'Failed to fetch user organizations', 500, 'ServerError');
  }
});

// Set user's organization (admin only)
router.post('/user/:userId/set', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'InvalidRequest');
    }

    const schema = z.object({
      organizationId: z.number().nullable(),
    });

    const { organizationId } = schema.parse(req.body);

    // If organizationId is provided, verify it exists
    if (organizationId !== null) {
      const organization = await storage.getOrganization(organizationId);
      if (!organization) {
        return sendError(res, 'Organization not found', 404, 'NotFound');
      }
      
      // Get the current user to update organization admin status
      const currentUser = await storage.getUser(userId);
      if (!currentUser) {
        return sendError(res, 'User not found', 404, 'NotFound');
      }
    }
    
    // setUserOrganization method handles setting isOrganizationAdmin
    const updatedUser = await storage.setUserOrganization(userId, organizationId);
    sendSuccess(res, updatedUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 'Invalid data', 400, 'ValidationError');
    }
    console.error(`Error setting organization for user ${req.params.userId}:`, error);
    sendError(res, 'Failed to set user organization', 500, 'ServerError');
  }
});

// Get organization leagues
router.get('/:id/leagues', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid organization ID', 400, 'InvalidRequest');
    }

    const organization = await storage.getOrganization(id);
    if (!organization) {
      return sendError(res, 'Organization not found', 404, 'NotFound');
    }

    if (!requireOrganizationAccess(req, id)) {
      return sendError(res, 'You do not have access to this organization', 403, 'Forbidden');
    }

    const leagues = await storage.getOrganizationLeagues(id);
    sendSuccess(res, leagues);
  } catch (error) {
    console.error(`Error fetching leagues for organization ${req.params.id}:`, error);
    sendError(res, 'Failed to fetch organization leagues', 500, 'ServerError');
  }
});

export default router;