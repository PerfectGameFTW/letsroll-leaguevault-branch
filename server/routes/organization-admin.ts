import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { storage } from '../storage';
import { sendSuccess, sendError, sanitizeUser, handleZodError, handleUserOrgError } from '../utils/api';
import { hashPassword, destroyOtherSessionsForUser } from '../auth';
import {
  sendInviteEmail,
  sendTemplatedEmail,
  getBaseUrl,
  getOrgLogoUrl,
  sendPasswordChangedNotification,
} from '../services/email';
import { passwordSchema } from '@shared/password-validation';
import { z } from 'zod';
import { adminWriteLimiter, inviteLimiter } from '../middleware/rate-limit';
import { createLogger } from '../logger';

const log = createLogger("OrgAdmin");

// Define error code type for type safety
type ErrorCode = string;

const router = Router();

// Middleware to check if the user is an organization admin or a system admin
async function requireOrgAdminOrSystemAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return sendError(res, 'You must be logged in to access this resource', 401, 'UNAUTHORIZED');
  }

  // Allow system admins
  if (req.user!.role === 'system_admin') {
    return next();
  }

  if (req.user!.role === 'org_admin' && req.user!.organizationId) {
    return next();
  }

  return sendError(res, 'You do not have permission to access this resource', 403, 'FORBIDDEN');
}

// Get all users in the current user's organization
router.get('/users', requireOrgAdminOrSystemAdmin, async (req: Request, res: Response) => {
  try {
    // A system admin can specify any organization
    let organizationId: number | null = req.query.organizationId 
      ? parseInt(String(req.query.organizationId), 10) 
      : null;
    
    // For organization admins, force their own organization
    if (req.user!.role === 'org_admin') {
      organizationId = req.user!.organizationId;
    }
    
    if (!organizationId) {
      return sendError(res, 'Organization ID is required', 400, 'bad_request');
    }
    
    const users = await storage.getOrganizationUsers(organizationId);
    
    const bowlerIds = users
      .map((u) => u.bowlerId)
      .filter((id): id is number => id != null);

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

    const usersWithBowlerInfo = users.map((user) => {
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
router.patch('/users/:id/admin-status', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: Request, res: Response) => {
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
    
    if (req.user!.role === 'org_admin') {
      if (user.role === 'system_admin') {
        return sendError(res, 'Organization admins cannot modify system admin accounts', 403, 'forbidden');
      }
      if (user.organizationId !== req.user!.organizationId) {
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
    if (handleUserOrgError(res, error)) return;
    log.error('Error updating organization admin status:', error);
    return sendError(res, 'Failed to update organization admin status', 500, 'internal_error');
  }
});

// Add a user to the organization
router.post('/users/:id/add', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: Request, res: Response) => {
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
    
    if (req.user!.role === 'system_admin' && req.body.organizationId !== undefined) {
      organizationId = parseInt(String(req.body.organizationId), 10);
      if (isNaN(organizationId)) {
        return sendError(res, 'Invalid organization ID', 400, 'bad_request');
      }
    } else {
      // Organization admins must use their own organization
      if (!req.user!.organizationId) {
        return sendError(res, 'Organization ID is required', 400, 'bad_request');
      }
      organizationId = req.user!.organizationId;
    }
    
    if (!organizationId) {
      return sendError(res, 'Organization ID is required', 400, 'bad_request');
    }
    
    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'not_found');
    }

    if (req.user!.role === 'org_admin' && user.role === 'system_admin') {
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
    if (handleUserOrgError(res, error)) return;
    log.error('Error adding user to organization:', error);
    return sendError(res, 'Failed to add user to organization', 500, 'internal_error');
  }
});

// Permanently delete a user account (#268). Replaces the old "remove
// from organization" path, which can no longer leave a non-admin user
// orphaned thanks to the `users_role_org_required` CHECK constraint.
router.delete('/users/:id', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'bad_request');
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'not_found');
    }

    // Authorization: deletion is intentionally locked down so neither
    // an org_admin nor a system_admin can ever delete:
    //   - themselves (would lock them out, and for the only sysadmin
    //     would brick the platform)
    //   - another system_admin (audit-trail FK is RESTRICT, and admin
    //     accounts must be demoted via system-admin tooling first)
    if (user.id === req.user!.id) {
      return sendError(res, 'You cannot delete your own account', 403, 'forbidden');
    }
    if (user.role === 'system_admin') {
      return sendError(
        res,
        'System admin accounts cannot be deleted from this page. Demote the user first.',
        403,
        'forbidden',
      );
    }

    if (req.user!.role === 'org_admin' && user.organizationId !== req.user!.organizationId) {
      return sendError(res, 'You can only delete users from your own organization', 403, 'forbidden');
    }

    // Last-org-admin guard applies regardless of who the caller is —
    // a system_admin must not be able to leave an organization with
    // zero administrators either, since that effectively orphans the
    // tenant from a management perspective.
    if (user.role === 'org_admin' && user.organizationId) {
      const adminCount = await storage.countOrgAdmins(user.organizationId);
      if (adminCount <= 1) {
        return sendError(res, 'Cannot delete the last administrator in this organization', 400, 'bad_request');
      }
    }

    const deleted = await storage.deleteUser(userId);
    log.info('User permanently deleted', {
      deletedUserId: deleted.id,
      deletedEmail: deleted.email,
      actingUserId: req.user!.id,
    });
    return sendSuccess(res, { id: deleted.id, email: deleted.email });
  } catch (error) {
    const errObj = (error && typeof error === 'object') ? error as { name?: string; message?: string } : {};
    if (errObj.name === 'CannotDeleteAdminError') {
      return sendError(res, errObj.message ?? 'Cannot delete admin', 403, 'forbidden');
    }
    if (errObj.name === 'UserHasAuditTrailError') {
      return sendError(res, errObj.message ?? 'Audit trail conflict', 409, 'AUDIT_TRAIL_CONFLICT');
    }
    log.error('Error deleting user:', error);
    return sendError(res, 'Failed to delete user', 500, 'internal_error');
  }
});

// Update a user's location assignment
router.patch('/users/:id/location', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: Request, res: Response) => {
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

    if (req.user!.role === 'org_admin') {
      if (user.role === 'system_admin') {
        return sendError(res, 'Organization admins cannot modify system admin accounts', 403, 'forbidden');
      }
      if (user.organizationId !== req.user!.organizationId) {
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

router.post('/users/create', requireOrgAdminOrSystemAdmin, inviteLimiter, async (req: Request, res: Response) => {
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
    if (req.user!.role === 'system_admin' && req.body.organizationId) {
      organizationId = parseInt(String(req.body.organizationId), 10);
    } else {
      if (!req.user!.organizationId) {
        return sendError(res, 'Organization ID is required', 400, 'bad_request');
      }
      organizationId = req.user!.organizationId;
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

    const baseUrl = getBaseUrl(organization);
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
    if (handleUserOrgError(res, error)) return;
    log.error('Error creating user:', error);
    return sendError(res, 'Failed to create user', 500, 'internal_error');
  }
});

// Admin-driven password reset (task #416). Mirrors the security
// surface of the self-service change-password endpoint at
// server/routes/account.ts:686 — hash, persist, invalidate any
// pending email-change tokens, destroy other sessions for the
// target user, and dispatch the "your password was just changed"
// notification with `actor: 'admin'` so the recipient can tell a
// delegated rotation apart from an account takeover. The notice
// is fire-and-forget; an outbound email failure must NOT roll back
// the password update that already committed (tested in
// tests/unit/admin-reset-password-notification.test.ts).
//
// Authorization rules (intentionally strict):
//   - Caller must be org_admin (in their own org) or system_admin
//     (the existing `requireOrgAdminOrSystemAdmin` middleware).
//   - Caller cannot reset their OWN password through this endpoint
//     — that's what /api/account/change-password is for, and it
//     requires the current password as a defense-in-depth check.
//   - Caller cannot reset another system_admin (matches the same
//     guard on /users/:id/admin-status and /users/:id earlier in
//     this file — system_admin demotion / mutation goes through
//     dedicated tooling so we don't have one admin silently
//     unlocking another's account).
//   - org_admin callers can only act on users in their own org.
router.post('/users/:id/reset-password', requireOrgAdminOrSystemAdmin, adminWriteLimiter, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'bad_request');
    }

    const schema = z.object({ newPassword: passwordSchema });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return handleZodError(res, parseResult.error);
    }
    const { newPassword } = parseResult.data;

    const targetUser = await storage.getUser(userId);
    if (!targetUser) {
      return sendError(res, 'User not found', 404, 'not_found');
    }

    if (targetUser.id === req.user!.id) {
      return sendError(
        res,
        'Use change-password to rotate your own password',
        403,
        'forbidden',
      );
    }

    if (targetUser.role === 'system_admin') {
      return sendError(
        res,
        'System admin passwords cannot be reset from this endpoint',
        403,
        'forbidden',
      );
    }

    if (
      req.user!.role === 'org_admin' &&
      targetUser.organizationId !== req.user!.organizationId
    ) {
      return sendError(
        res,
        'You can only reset passwords for users in your own organization',
        403,
        'forbidden',
      );
    }

    const hashedNew = await hashPassword(newPassword);
    await storage.updateUser(targetUser.id, { password: hashedNew });

    // Defense-in-depth: any in-flight email-change tokens belonging
    // to the target user could outlive the rotation if not cleared.
    // Mirrors the strict behaviour of /api/account/change-password
    // — a failure here is fail-closed (bubbles to the route's outer
    // 500) rather than silently leaving a stolen confirmation link
    // active. The password row is already persisted at this point,
    // so the caller can safely retry: re-running invalidation is
    // idempotent.
    const invalidated = await storage.invalidatePendingEmailChangeRequestsForUser(targetUser.id);
    if (invalidated > 0) {
      log.info('Invalidated pending email-change requests on admin password reset', {
        targetUserId: targetUser.id,
        actingUserId: req.user!.id,
        count: invalidated,
      });
    }

    // Force-log-out every other session for the target user. The
    // admin is rotating their password specifically because they're
    // assumed to need fresh access — leaving stale cookies alive
    // defeats the purpose. We do NOT pass a current-session id to
    // preserve here because the admin's session cookie belongs to a
    // DIFFERENT user (themselves), so there's nothing to keep.
    try {
      const dropped = await destroyOtherSessionsForUser(targetUser.id, null);
      if (dropped > 0) {
        log.info('Destroyed sessions on admin password reset', {
          targetUserId: targetUser.id,
          actingUserId: req.user!.id,
          count: dropped,
        });
      }
    } catch (err) {
      log.error('Failed to destroy sessions on admin password reset', {
        targetUserId: targetUser.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Industry-standard "your password was just changed" notice
    // (task #416). Best-effort — a SendGrid failure must not roll
    // back the password rotation that already committed. Sent with
    // `actor: 'admin'` so the i18n "performed by an administrator"
    // line is included in the rendered body.
    try {
      const rawUa = (req.get('user-agent') ?? '').slice(0, 256);
      void sendPasswordChangedNotification(targetUser.email, targetUser.name, {
        changedAt: new Date(),
        ipAddress: req.ip ?? null,
        userAgent: rawUa || null,
        locale: targetUser.preferredLanguage ?? null,
        actor: 'admin',
      })
        .then(ok => {
          if (!ok) {
            log.warn('Password-changed notification returned false (admin reset)', {
              targetUserId: targetUser.id,
            });
          }
        })
        .catch(err => {
          log.error('Password-changed notification threw (admin reset)', {
            targetUserId: targetUser.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    } catch (notifyError) {
      log.error('Failed to schedule password-changed notification (admin reset)', {
        targetUserId: targetUser.id,
        error: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }

    log.info('Admin reset user password', {
      targetUserId: targetUser.id,
      actingUserId: req.user!.id,
    });

    return sendSuccess(res, { id: targetUser.id });
  } catch (error) {
    if (handleUserOrgError(res, error)) return;
    log.error('Error resetting user password:', error);
    return sendError(res, 'Failed to reset user password', 500, 'internal_error');
  }
});

router.post('/users/:id/resend-invite', requireOrgAdminOrSystemAdmin, inviteLimiter, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return sendError(res, 'Invalid user ID', 400, 'bad_request');
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return sendError(res, 'User not found', 404, 'not_found');
    }

    if (req.user!.role === 'org_admin') {
      if (user.organizationId !== req.user!.organizationId) {
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