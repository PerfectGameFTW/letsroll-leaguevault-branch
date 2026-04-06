import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { storage } from '../storage';
import { sendSuccess, sendError, sanitizeUser, handleZodError } from '../utils/api';
import { hashPassword } from '../auth';
import { sendInviteEmail, sendTemplatedEmail, getBaseUrl, getOrgLogoUrl } from '../services/email';
import { z } from 'zod';
import { adminWriteLimiter, inviteLimiter } from '../middleware/rate-limit';
import { createLogger } from '../logger';

const log = createLogger("OrgAdmin");

// Define error code type for type safety
type ErrorCode = string;

const router = Router();

// Middleware to check if the user is an organization admin or a system admin
async function requireOrgAdminOrSystemAdmin(req: any, res: Response, next: any) {
  if (!req.isAuthenticated() || !req.user) {
    return sendError(res, 'You must be logged in to access this resource', 401, 'UNAUTHORIZED');
  }

  // Allow system admins
  if (req.user.role === 'system_admin') {
    return next();
  }

  if (req.user.role === 'org_admin' && req.user.organizationId) {
    return next();
  }

  return sendError(res, 'You do not have permission to access this resource', 403, 'FORBIDDEN');
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
      return sendError(res, 'Organization ID is required', 400, 'bad_request');
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
      const safeUser = sanitizeUser(user);
      if (!user.bowlerId) {
        return { ...safeUser, linkedBowler: null };
      }
      const bowler = bowlerMap.get(user.bowlerId);
      if (!bowler) {
        return { ...safeUser, linkedBowler: null };
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
        ...safeUser,
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
    log.error('Error getting organization users:', error);
    return sendError(res, 'Failed to get organization users', 500, 'internal_error');
  }
});

// Update a user's organization admin status
router.patch('/users/:id/admin-status', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'bad_request');
    }
    
    // Validate request body
    const schema = z.object({
      makeOrgAdmin: z.boolean(),
    });
    
    const parseResult = schema.safeParse({
      makeOrgAdmin: req.body.isOrganizationAdmin ?? req.body.makeOrgAdmin
    });
    if (!parseResult.success) {
      return handleZodError(res, parseResult.error);
    }
    
    const { makeOrgAdmin } = parseResult.data;
    
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'not_found');
    }
    
    if (req.user.role === 'org_admin') {
      if (user.role === 'system_admin') {
        return sendError(res, 'Organization admins cannot modify system admin accounts', 403, 'forbidden');
      }
      if (user.organizationId !== req.user.organizationId) {
        return sendError(res, 'You can only update users in your own organization', 403, 'forbidden');
      }
    }
    
    const newRole = makeOrgAdmin ? 'org_admin' : 'user';

    if (!makeOrgAdmin && user.role === 'org_admin' && user.organizationId) {
      const adminCount = await storage.countOrgAdmins(user.organizationId);
      if (adminCount <= 1) {
        return sendError(res, 'Cannot remove the last administrator from this organization', 400, 'bad_request');
      }
    }

    const updatedUser = await storage.updateUserRole(userId, newRole);
    return sendSuccess(res, sanitizeUser(updatedUser));
  } catch (error) {
    log.error('Error updating organization admin status:', error);
    return sendError(res, 'Failed to update organization admin status', 500, 'internal_error');
  }
});

// Add a user to the organization
router.post('/users/:id/add', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'bad_request');
    }
    
    // Validate request body
    const schema = z.object({
      organizationId: z.number().optional(),
      makeOrgAdmin: z.boolean().optional().default(false),
    });
    
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return handleZodError(res, parseResult.error);
    }
    
    const { makeOrgAdmin } = parseResult.data;
    
    let organizationId: number;
    
    if (req.user.role === 'system_admin' && req.body.organizationId !== undefined) {
      organizationId = parseInt(String(req.body.organizationId), 10);
      if (isNaN(organizationId)) {
        return sendError(res, 'Invalid organization ID', 400, 'bad_request');
      }
    } else {
      // Organization admins must use their own organization
      organizationId = req.user.organizationId;
    }
    
    if (!organizationId) {
      return sendError(res, 'Organization ID is required', 400, 'bad_request');
    }
    
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'not_found');
    }

    if (req.user.role === 'org_admin' && user.role === 'system_admin') {
      return sendError(res, 'Organization admins cannot modify system admin accounts', 403, 'forbidden');
    }

    // Check if user is already in an organization
    if (user.organizationId) {
      // If they're in the same org we're trying to add them to, just update admin status
      if (user.organizationId === organizationId) {
        const desiredRole = makeOrgAdmin ? 'org_admin' : 'user';
        if (desiredRole !== user.role) {
          if (desiredRole === 'user' && user.role === 'org_admin') {
            const adminCount = await storage.countOrgAdmins(user.organizationId);
            if (adminCount <= 1) {
              return sendError(res, 'Cannot remove the last administrator from this organization', 400, 'bad_request');
            }
          }
          const updatedUser = await storage.updateUserRole(userId, desiredRole);
          return sendSuccess(res, sanitizeUser(updatedUser));
        }
        
        return sendSuccess(res, sanitizeUser(user));
      }
      
      return sendError(res, 'User is already in another organization', 409, 'conflict');
    }
    
    // Use setUserOrganization to set the user's organization
    const updatedUser = await storage.setUserOrganization(userId, organizationId);
    
    // If requested to make user an org admin and they aren't already
    if (makeOrgAdmin && updatedUser.role !== 'org_admin') {
      await storage.updateUserRole(userId, 'org_admin');
    }
    
    const refreshedUser = await storage.getUser(userId);
    return sendSuccess(res, sanitizeUser(refreshedUser!));
  } catch (error) {
    log.error('Error adding user to organization:', error);
    return sendError(res, 'Failed to add user to organization', 500, 'internal_error');
  }
});

// Remove a user from the organization
router.delete('/users/:id/remove', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'bad_request');
    }
    
    // Get the user
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'not_found');
    }
    
    // Organization admins can only remove users from their own organization
    if (req.user.role === 'org_admin') {
      if (user.role === 'system_admin') {
        return sendError(res, 'Organization admins cannot modify system admin accounts', 403, 'forbidden');
      }
      if (user.organizationId !== req.user.organizationId) {
        return sendError(res, 'You can only remove users from your own organization', 403, 'forbidden');
      }
      
      if (user.id === req.user.id) {
        return sendError(res, 'You cannot remove yourself from the organization', 403, 'forbidden');
      }
    }
    
    // Check if user is in an organization
    if (!user.organizationId) {
      return sendError(res, 'User is not in any organization', 400, 'bad_request');
    }

    if (user.role === 'org_admin') {
      const adminCount = await storage.countOrgAdmins(user.organizationId);
      if (adminCount <= 1) {
        return sendError(res, 'Cannot remove the last administrator from this organization', 400, 'bad_request');
      }
    }
    
    const updatedUser = await storage.setUserOrganization(userId, null);
    return sendSuccess(res, sanitizeUser(updatedUser));
  } catch (error) {
    log.error('Error removing user from organization:', error);
    return sendError(res, 'Failed to remove user from organization', 500, 'internal_error');
  }
});

// Update a user's location assignment
router.patch('/users/:id/location', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'bad_request');
    }

    const schema = z.object({
      locationId: z.number().int().positive().nullable(),
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return handleZodError(res, parseResult.error);
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'not_found');
    }

    if (req.user.role === 'org_admin') {
      if (user.role === 'system_admin') {
        return sendError(res, 'Organization admins cannot modify system admin accounts', 403, 'forbidden');
      }
      if (user.organizationId !== req.user.organizationId) {
        return sendError(res, 'You can only update users in your own organization', 403, 'forbidden');
      }
    }

    const updatedUser = await storage.setUserLocation(userId, parseResult.data.locationId);
    return sendSuccess(res, sanitizeUser(updatedUser));
  } catch (error) {
    log.error('Error updating user location:', error);
    return sendError(res, 'Failed to update user location', 500, 'internal_error');
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
      return handleZodError(res, parseResult.error);
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
      return sendError(res, 'Organization ID is required', 400, 'bad_request');
    }

    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return sendError(res, 'A user with this email address already exists', 409, 'conflict');
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

    const baseUrl = getBaseUrl(organization?.slug);
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
    log.error('Error creating user:', error);
    return sendError(res, 'Failed to create user', 500, 'internal_error');
  }
});

router.post('/users/:id/resend-invite', requireOrgAdminOrSystemAdmin, inviteLimiter, async (req: any, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'bad_request');
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'not_found');
    }

    if (req.user.role === 'org_admin') {
      if (user.organizationId !== req.user.organizationId) {
        return sendError(res, 'You can only manage users in your own organization', 403, 'forbidden');
      }
    }

    const inviteToken = randomBytes(32).toString('hex');
    const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await storage.setUserInviteToken(userId, inviteToken, inviteTokenExpiry);

    let organizationId = user.organizationId;
    const organization = organizationId ? await storage.getOrganization(organizationId) : null;

    const firstName = user.name.split(' ')[0];
    const emailSent = await sendInviteEmail(user.email, firstName, inviteToken, organization?.name, organization?.id, organization?.slug);

    return sendSuccess(res, { emailSent });
  } catch (error) {
    log.error('Error resending invite:', error);
    return sendError(res, 'Failed to resend invite', 500, 'internal_error');
  }
});

export default router;