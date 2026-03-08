import { Router } from 'express';
import { randomBytes } from 'crypto';
import { storage } from '../storage';
import { insertLeagueSchema, partialLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';
import { getOrganizationFilter, filterByOrganization } from '../middleware/organization';
import { hashPassword } from '../auth';
import { sendInviteEmail } from '../services/email';

const router = Router();

// Apply organization filtering to all league routes
router.use(filterByOrganization);

router.get("/", async (req: any, res) => {
  try {
    const organizationId = getOrganizationFilter(req);
    
    let leagues = await storage.getLeagues(organizationId);
    
    const locationId = req.query.locationId ? parseInt(req.query.locationId) : null;
    if (locationId) {
      leagues = leagues.filter(l => l.locationId === locationId);
    }
    
    sendSuccess(res, leagues);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch leagues');
  }
});

router.get("/:id", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Use the organization middleware's filter logic
    const organizationId = getOrganizationFilter(req);
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      // System admins can access all leagues
      req.user?.isAdmin || 
      // Users can access leagues with no organization
      league.organizationId === null || 
      // Users can access leagues in their own organization
      (organizationId !== null && league.organizationId === organizationId);
    
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    sendSuccess(res, league);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch league');
  }
});

router.post("/", async (req: any, res) => {
  try {
    // Parse league data
    const league = insertLeagueSchema.parse({
      ...req.body,
      seasonStart: new Date(req.body.seasonStart),
      seasonEnd: new Date(req.body.seasonEnd)
    });
    
    // Get organization filter from middleware
    const organizationId = getOrganizationFilter(req);
    
    // Set the organization ID from the user's context if not already provided
    if (organizationId !== null && !league.organizationId) {
      league.organizationId = organizationId;
    } else if (!league.organizationId) {
      league.organizationId = req.user?.organizationId || null;
    }
    
    const created = await storage.createLeague(league);
    sendSuccess(res, created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, 'Validation error', 400, 'VALIDATION_ERROR', error.format());
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create league');
    }
  }
});

router.patch("/:id", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get the league to verify organization access
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Use the organization middleware's filter logic
    const organizationId = getOrganizationFilter(req);
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      // System admins can access all leagues
      req.user?.isAdmin || 
      // Users can access leagues with no organization
      league.organizationId === null || 
      // Users can access leagues in their own organization
      (organizationId !== null && league.organizationId === organizationId);
    
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    // Non-admin users cannot change the organization of a league
    if (!req.user?.isAdmin && req.body.organizationId !== undefined) {
      return sendError(res, "You don't have permission to change the organization of this league", 403, 'FORBIDDEN');
    }
    
    const update = partialLeagueSchema.parse({
      ...req.body,
      seasonStart: req.body.seasonStart ? new Date(req.body.seasonStart) : undefined,
      seasonEnd: req.body.seasonEnd ? new Date(req.body.seasonEnd) : undefined
    });
    
    const updated = await storage.updateLeague(id, update);
    sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendError(res, 'Validation error', 400, 'VALIDATION_ERROR', error.format());
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update league');
    }
  }
});

// Archive a league
router.patch("/:id/archive", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const league = await storage.getLeague(id);
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    const organizationId = getOrganizationFilter(req);
    const userHasAccess = req.user?.isAdmin || league.organizationId === null || (organizationId !== null && league.organizationId === organizationId);
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    const archived = await storage.archiveLeague(id);
    sendSuccess(res, archived);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to archive league');
  }
});

// Restore an archived league
router.patch("/:id/restore", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const league = await storage.getLeague(id);
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    const organizationId = getOrganizationFilter(req);
    const userHasAccess = req.user?.isAdmin || league.organizationId === null || (organizationId !== null && league.organizationId === organizationId);
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    const restored = await storage.restoreLeague(id);
    sendSuccess(res, restored);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to restore league');
  }
});

router.delete("/:id", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get the league to verify organization access
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    // Use the organization middleware's filter logic
    const organizationId = getOrganizationFilter(req);
    
    // Check if user has access to this league's organization
    const userHasAccess = 
      // System admins can access all leagues
      req.user?.isAdmin || 
      // Users can access leagues with no organization
      league.organizationId === null || 
      // Users can access leagues in their own organization
      (organizationId !== null && league.organizationId === organizationId);
    
    if (!userHasAccess) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    const teams = await storage.getTeams(id);

    for (const team of teams) {
      const teamBowlers = await storage.getBowlers(team.id);
      for (const bowler of teamBowlers) {
        await storage.updateBowler(bowler.id, { active: false, order: 0 });
      }
      await storage.deleteTeam(team.id);
    }

    await storage.deleteLeague(id);
    sendSuccess(res, null, 204);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to delete league');
  }
});

router.post("/:id/send-invites", async (req: any, res) => {
  try {
    const leagueId = parseInt(req.params.id);
    const league = await storage.getLeague(leagueId);

    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }

    const organizationId = getOrganizationFilter(req);
    const userHasAccess =
      req.user?.isAdmin ||
      league.organizationId === null ||
      (organizationId !== null && league.organizationId === organizationId);

    if (!userHasAccess) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    const bowlerLeagueEntries = await storage.getBowlerLeagues({ leagueId });

    let sent = 0;
    let alreadyRegistered = 0;
    let noEmail = 0;

    for (const bl of bowlerLeagueEntries) {
      const bowler = await storage.getBowler(bl.bowlerId);
      if (!bowler) continue;

      if (!bowler.email) {
        noEmail++;
        continue;
      }

      const existingUser = await storage.getUserByEmail(bowler.email);
      if (existingUser) {
        alreadyRegistered++;
        continue;
      }

      const placeholderPassword = await hashPassword(randomBytes(32).toString('hex'));
      const inviteToken = randomBytes(32).toString('hex');
      const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const newUser = await storage.createUser({
        email: bowler.email,
        password: placeholderPassword,
        name: bowler.name,
        isAdmin: false,
        isOrganizationAdmin: false,
        organizationId: league.organizationId || null,
      });

      await storage.setUserInviteToken(newUser.id, inviteToken, inviteTokenExpiry);
      await storage.linkUserToBowler(newUser.id, bowler.id);

      const organization = league.organizationId
        ? await storage.getOrganization(league.organizationId)
        : null;

      const firstName = bowler.name.split(' ')[0];
      await sendInviteEmail(bowler.email, firstName, inviteToken, organization?.name);

      sent++;
    }

    sendSuccess(res, { sent, alreadyRegistered, noEmail });
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to send invites');
  }
});

export default router;
