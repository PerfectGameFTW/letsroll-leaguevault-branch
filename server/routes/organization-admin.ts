import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { storage } from '../storage';
import { sendSuccess, sendError, sanitizeUser } from '../utils/api';
import { hashPassword } from '../auth';
import { sendInviteEmail, sendTemplatedEmail, getBaseUrl, getOrgLogoUrl } from '../services/email';
import { z } from 'zod';
import { adminWriteLimiter, inviteLimiter } from '../middleware/rate-limit';

// Define error code type for type safety
type ErrorCode = string;

const router = Router();

// Middleware to check if the user is an organization admin or a system admin
async function requireOrgAdminOrSystemAdmin(req: any, res: Response, next: any) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ success: false, error: { code: 'unauthorized', message: 'You must be logged in to access this resource' } });
  }

  // Allow system admins
  if (req.user.role === 'system_admin') {
    return next();
  }

  if (req.user.role === 'org_admin' && req.user.organizationId) {
    return next();
  }

  return res.status(403).json({ success: false, error: { code: 'forbidden', message: 'You do not have permission to access this resource' } });
}

// Get all users in the current user's organization
router.get('/users', requireOrgAdminOrSystemAdmin, async (req: any, res: Response) => {
  try {
    // A system admin can specify any organization
    let organizationId: number | null = req.query.organizationId 
      ? parseInt(String(req.query.organizationId), 10) 
      : null;
    
    // For organization admins, force their own organization
    if (req.user.role === 'org_admin') {
      organizationId = req.user.organizationId;
    }
    
    if (!organizationId) {
      return sendError(res, 'bad_request', 'Organization ID is required', 400);
    }
    
    const users = await storage.getOrganizationUsers(organizationId);
    
    const bowlerIds = users
      .map((u: any) => u.bowlerId)
      .filter((id: any): id is number => id != null);

    const [allBowlers, allBowlerLeagueEntries] = await Promise.all([
      storage.getBowlersByIds(bowlerIds),
      storage.getBowlerLeaguesByBowlerIds(bowlerIds),
    ]);

    const bowlerMap = new Map(allBowlers.map(b => [b.id, b]));
    const blByBowler = new Map<number, typeof allBowlerLeagueEntries>();
    for (const bl of allBowlerLeagueEntries) {
      if (!blByBowler.has(bl.bowlerId)) blByBowler.set(bl.bowlerId, []);
      blByBowler.get(bl.bowlerId)!.push(bl);
    }

    const leagueIds = [...new Set(allBowlerLeagueEntries.map(bl => bl.leagueId))];
    const teamIds = [...new Set(allBowlerLeagueEntries.map(bl => bl.teamId))];
    const [allLeagues, allTeams] = await Promise.all([
      storage.getLeaguesByIds(leagueIds),
      storage.getTeamsByIds(teamIds),
    ]);
    const leagueMap = new Map(allLeagues.map(l => [l.id, l]));
    const teamMap = new Map(allTeams.map(t => [t.id, t]));

    const usersWithBowlerInfo = users.map((user: any) => {
      if (!user.bowlerId) {
        return { ...user, linkedBowler: null };
      }
      const bowler = bowlerMap.get(user.bowlerId);
      if (!bowler) {
        return { ...user, linkedBowler: null };
      }
      const entries = blByBowler.get(bowler.id) || [];
      let leagueName: string | null = null;
      let teamName: string | null = null;
      if (entries.length > 0) {
        const bl = entries[0];
        leagueName = leagueMap.get(bl.leagueId)?.name || null;
        teamName = teamMap.get(bl.teamId)?.name || null;
      }
      return {
        ...user,
        linkedBowler: {
          id: bowler.id,
          name: bowler.name,
          leagueName,
          teamName,
        },
      };
    });

    return sendSuccess(res, usersWithBowlerInfo);
  } catch (error) {
    console.error('[Org Admin Route] Error getting organization users:', error);
    return sendError(res, 'internal_error', 'Failed to get organization users', 500);
  }
});

// Update a user's organization admin status
router.patch('/users/:id/admin-status', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'bad_request', 'Invalid user ID', 400);
    }
    
    // Validate request body
    const schema = z.object({
      makeOrgAdmin: z.boolean(),
    });
    
    const parseResult = schema.safeParse({
      makeOrgAdmin: req.body.isOrganizationAdmin ?? req.body.makeOrgAdmin
    });
    if (!parseResult.success) {
      return sendError(res, 'validation_error', parseResult.error.message, 400);
    }
    
    const { makeOrgAdmin } = parseResult.data;
    
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'not_found', 'User not found', 404);
    }
    
    if (req.user.role === 'org_admin') {
      if (user.organizationId !== req.user.organizationId) {
        return sendError(res, 'forbidden', 'You can only update users in your own organization', 403);
      }
    }
    
    const newRole = makeOrgAdmin ? 'org_admin' : 'user';
    const updatedUser = await storage.updateUserRole(userId, newRole);
    return sendSuccess(res, updatedUser);
  } catch (error) {
    console.error('[Org Admin Route] Error updating organization admin status:', error);
    return sendError(res, 'internal_error', 'Failed to update organization admin status', 500);
  }
});

// Add a user to the organization
router.post('/users/:id/add', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'bad_request', 'Invalid user ID', 400);
    }
    
    // Validate request body
    const schema = z.object({
      organizationId: z.number().optional(),
      makeOrgAdmin: z.boolean().optional().default(false),
    });
    
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, 'validation_error', parseResult.error.message, 400);
    }
    
    const { makeOrgAdmin } = parseResult.data;
    
    let organizationId: number;
    
    if (req.user.role === 'system_admin' && req.body.organizationId !== undefined) {
      organizationId = parseInt(String(req.body.organizationId), 10);
      if (isNaN(organizationId)) {
        return sendError(res, 'bad_request', 'Invalid organization ID', 400);
      }
    } else {
      // Organization admins must use their own organization
      organizationId = req.user.organizationId;
    }
    
    if (!organizationId) {
      return sendError(res, 'bad_request', 'Organization ID is required', 400);
    }
    
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'not_found', 'User not found', 404);
    }

    // Check if user is already in an organization
    if (user.organizationId) {
      // If they're in the same org we're trying to add them to, just update admin status
      if (user.organizationId === organizationId) {
        const desiredRole = makeOrgAdmin ? 'org_admin' : 'user';
        if (desiredRole !== user.role) {
          const updatedUser = await storage.updateUserRole(userId, desiredRole);
          return sendSuccess(res, updatedUser);
        }
        
        return sendSuccess(res, user);
      }
      
      return sendError(res, 'conflict', 'User is already in another organization', 409);
    }
    
    // Use setUserOrganization to set the user's organization
    const updatedUser = await storage.setUserOrganization(userId, organizationId);
    
    // If requested to make user an org admin and they aren't already
    if (makeOrgAdmin && updatedUser.role !== 'org_admin') {
      await storage.updateUserRole(userId, 'org_admin');
    }
    
    // Get fresh user data
    const refreshedUser = await storage.getUser(userId);
    return sendSuccess(res, refreshedUser);
  } catch (error) {
    console.error('[Org Admin Route] Error adding user to organization:', error);
    return sendError(res, 'internal_error', 'Failed to add user to organization', 500);
  }
});

// Remove a user from the organization
router.delete('/users/:id/remove', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'bad_request', 'Invalid user ID', 400);
    }
    
    // Get the user
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'not_found', 'User not found', 404);
    }
    
    // Organization admins can only remove users from their own organization
    if (req.user.role === 'org_admin') {
      if (user.organizationId !== req.user.organizationId) {
        return sendError(res, 'forbidden', 'You can only remove users from your own organization', 403);
      }
      
      if (user.id === req.user.id) {
        return sendError(res, 'forbidden', 'You cannot remove yourself from the organization', 403);
      }
    }
    
    // Check if user is in an organization
    if (!user.organizationId) {
      return sendError(res, 'bad_request', 'User is not in any organization', 400);
    }
    
    // Remove user from organization
    const updatedUser = await storage.setUserOrganization(userId, null);
    return sendSuccess(res, updatedUser);
  } catch (error) {
    console.error('[Org Admin Route] Error removing user from organization:', error);
    return sendError(res, 'internal_error', 'Failed to remove user from organization', 500);
  }
});

// Update a user's location assignment
router.patch('/users/:id/location', requireOrgAdminOrSystemAdmin, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'bad_request', 'Invalid user ID', 400);
    }

    const schema = z.object({
      locationId: z.number().int().positive().nullable(),
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, 'validation_error', parseResult.error.message, 400);
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'not_found', 'User not found', 404);
    }

    if (req.user.role === 'org_admin') {
      if (user.organizationId !== req.user.organizationId) {
        return sendError(res, 'forbidden', 'You can only update users in your own organization', 403);
      }
    }

    const updatedUser = await storage.setUserLocation(userId, parseResult.data.locationId);
    return sendSuccess(res, updatedUser);
  } catch (error) {
    console.error('[Org Admin Route] Error updating user location:', error);
    return sendError(res, 'internal_error', 'Failed to update user location', 500);
  }
});

router.post('/users/create', requireOrgAdminOrSystemAdmin, inviteLimiter, async (req: any, res: Response) => {
  try {
    const schema = z.object({
      firstName: z.string().min(1, 'First name is required').max(50),
      lastName: z.string().min(1, 'Last name is required').max(50),
      email: z.string().email('Invalid email address'),
      makeOrgAdmin: z.boolean().default(false),
      locationId: z.number().int().positive().nullable().optional(),
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, 'validation_error', parseResult.error.errors.map(e => e.message).join(', '), 400);
    }

    const { firstName, lastName, email, makeOrgAdmin, locationId } = parseResult.data;
    const fullName = `${firstName} ${lastName}`;

    let organizationId: number;
    if (req.user.role === 'system_admin' && req.body.organizationId) {
      organizationId = parseInt(String(req.body.organizationId), 10);
    } else {
      organizationId = req.user.organizationId;
    }

    if (!organizationId) {
      return sendError(res, 'bad_request', 'Organization ID is required', 400);
    }

    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return sendError(res, 'conflict', 'A user with this email address already exists', 409);
    }

    const placeholderPassword = await hashPassword(randomBytes(32).toString('hex'));

    const inviteToken = randomBytes(32).toString('hex');
    const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const newUser = await storage.createUser({
      email,
      password: placeholderPassword,
      name: fullName,
      role: makeOrgAdmin ? 'org_admin' : 'user',
      organizationId,
    });

    await storage.setUserInviteToken(newUser.id, inviteToken, inviteTokenExpiry);

    if (locationId && !makeOrgAdmin) {
      await storage.setUserLocation(newUser.id, locationId);
    }

    const organization = await storage.getOrganization(organizationId);

    const baseUrl = getBaseUrl();
    const setupUrl = `${baseUrl}/set-password?token=${inviteToken}`;
    const variables: Record<string, string> = {
      user_name: firstName,
      invite_link: setupUrl,
      organization_name: organization?.name || 'your organization',
    };
    if (organization?.id) {
      variables.organization_logo_url = getOrgLogoUrl(organization.id);
    }
    const emailSent = await sendTemplatedEmail('org_end_user_invite', email, variables);

    const finalUser = await storage.getUser(newUser.id);

    return sendSuccess(res, { user: sanitizeUser(finalUser!), emailSent });
  } catch (error) {
    console.error('[Org Admin Route] Error creating user:', error);
    return sendError(res, 'internal_error', 'Failed to create user', 500);
  }
});

router.post('/users/:id/resend-invite', requireOrgAdminOrSystemAdmin, inviteLimiter, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'bad_request', 'Invalid user ID', 400);
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'not_found', 'User not found', 404);
    }

    if (req.user.role === 'org_admin') {
      if (user.organizationId !== req.user.organizationId) {
        return sendError(res, 'forbidden', 'You can only manage users in your own organization', 403);
      }
    }

    const inviteToken = randomBytes(32).toString('hex');
    const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await storage.setUserInviteToken(userId, inviteToken, inviteTokenExpiry);

    let organizationId = user.organizationId;
    const organization = organizationId ? await storage.getOrganization(organizationId) : null;

    const firstName = user.name.split(' ')[0];
    const emailSent = await sendInviteEmail(user.email, firstName, inviteToken, organization?.name, organization?.id);

    return sendSuccess(res, { emailSent });
  } catch (error) {
    console.error('[Org Admin Route] Error resending invite:', error);
    return sendError(res, 'internal_error', 'Failed to resend invite', 500);
  }
});

export default router;