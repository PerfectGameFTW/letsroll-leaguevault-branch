import { Router } from 'express';
import { storage } from '../storage.js';
import { insertBowlerSchema, partialBowlerSchema } from "@shared/schema.js";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api.js';
import { createOrUpdateCustomer } from '../services/square.js';
import { hasAccessToTeam, hasAccessToBowler } from '../utils/access-control.js';
import { syncBowlerToBN, isBNConfigured } from '../services/bowlnow.js';

const router = Router();

router.get("/unlinked", async (req: any, res) => {
  try {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return sendError(res, "Authentication required", 401, 'UNAUTHORIZED');
    }

    let organizationId = req.query.organizationId ? parseInt(req.query.organizationId as string) : undefined;

    if (!req.user?.isAdmin && !req.user?.isOrganizationAdmin) {
      if (!req.user?.organizationId) {
        return sendError(res, "No organization context available", 403, 'FORBIDDEN');
      }
      organizationId = req.user.organizationId;
    }
    const allBowlers = await storage.getBowlers();
    const allUsers = await storage.getUsers();
    const allBowlerLeagues = await storage.getBowlerLeagues();

    const linkedBowlerIds = new Set(
      allUsers.filter(u => u.bowlerId !== null && u.bowlerId !== undefined).map(u => u.bowlerId!)
    );

    const unlinkedBowlers = allBowlers.filter(
      b => !linkedBowlerIds.has(b.id) && (!b.email || b.email.trim() === '')
    );

    const leagueIds = [...new Set(allBowlerLeagues.map(bl => bl.leagueId))];
    const teamIds = [...new Set(allBowlerLeagues.map(bl => bl.teamId))];

    const [leaguesData, teamsData] = await Promise.all([
      Promise.all(leagueIds.map(id => storage.getLeague(id))),
      Promise.all(teamIds.map(id => storage.getTeam(id))),
    ]);

    const leagueMap = new Map(leaguesData.filter(Boolean).map(l => [l!.id, l!]));
    const teamMap = new Map(teamsData.filter(Boolean).map(t => [t!.id, t!]));

    const grouped: Record<string, { league: { id: number; name: string }; teams: Record<string, { team: { id: number; name: string; number: number }; bowlers: { id: number; name: string }[] }> }> = {};

    for (const bowler of unlinkedBowlers) {
      const bowlerEntries = allBowlerLeagues.filter(bl => bl.bowlerId === bowler.id);
      for (const entry of bowlerEntries) {
        const league = leagueMap.get(entry.leagueId);
        const team = teamMap.get(entry.teamId);
        if (!league || !team) continue;
        if (organizationId && league.organizationId !== organizationId) continue;

        const leagueKey = String(league.id);
        if (!grouped[leagueKey]) {
          grouped[leagueKey] = { league: { id: league.id, name: league.name }, teams: {} };
        }
        const teamKey = String(team.id);
        if (!grouped[leagueKey].teams[teamKey]) {
          grouped[leagueKey].teams[teamKey] = { team: { id: team.id, name: team.name, number: team.number }, bowlers: [] };
        }
        if (!grouped[leagueKey].teams[teamKey].bowlers.some(b => b.id === bowler.id)) {
          grouped[leagueKey].teams[teamKey].bowlers.push({ id: bowler.id, name: bowler.name });
        }
      }
    }

    const result = Object.values(grouped).map(g => ({
      league: g.league,
      teams: Object.values(g.teams),
    }));

    sendSuccess(res, result);
  } catch (error) {
    console.error('[Bowlers] Error fetching unlinked bowlers:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch unlinked bowlers');
  }
});

router.get("/", async (req, res) => {
  try {
    const teamId = req.query.teamId ? parseInt(req.query.teamId as string) : undefined;
    const ids = req.query.ids ? (req.query.ids as string).split(',').map(id => parseInt(id)) : undefined;

    // Validate the teamId if provided
    if (teamId !== undefined && isNaN(teamId)) {
      return sendError(res, "Invalid team ID format", 400);
    }

    // Validate the ids if provided
    if (ids && ids.some(isNaN)) {
      return sendError(res, "Invalid bowler ID format in list", 400);
    }

    // If teamId is provided, check organization access
    if (teamId && !req.user?.isAdmin) {
      const hasAccess = await hasAccessToTeam(req, teamId);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this team's bowlers", 403, 'FORBIDDEN');
      }
    }

    // Fetch bowlers
    const bowlers = await storage.getBowlers(teamId);
    
    if (!bowlers || bowlers.length === 0) {
      return sendSuccess(res, []);
    }

    // If no teamId provided, we need to filter bowlers by organization
    let accessibleBowlers = bowlers;
    
    if (!teamId && !req.user?.isAdmin && req.user?.organizationId) {
      const [leagues, bowlerLeagues] = await Promise.all([
        storage.getLeagues(req.user.organizationId),
        storage.getBowlerLeagues(),
      ]);

      if (!leagues || leagues.length === 0) {
        return sendSuccess(res, []);
      }

      const leagueIdSet = new Set(leagues.map(l => l.id));
      const organizationBowlerIds = new Set(
        bowlerLeagues
          .filter(bl => leagueIdSet.has(bl.leagueId))
          .map(bl => bl.bowlerId)
      );

      accessibleBowlers = bowlers.filter(b => organizationBowlerIds.has(b.id));
    }

    // Filter by IDs if provided
    const filteredBowlers = ids 
      ? accessibleBowlers.filter(b => ids.includes(b.id))
      : accessibleBowlers;

    const allUsers = await storage.getUsers();
    const linkedBowlerIds = new Set(
      allUsers.filter(u => u.bowlerId != null).map(u => u.bowlerId)
    );

    const bowlersWithAccountStatus = filteredBowlers.map(b => ({
      ...b,
      hasAccount: linkedBowlerIds.has(b.id),
    }));

    sendSuccess(res, bowlersWithAccountStatus);
  } catch (error) {
    console.error('[Bowlers] Error fetching bowlers:', error);
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
    
    // Check organization access
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToBowler(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
      }
    }

    const allUsers = await storage.getUsers();
    const hasAccount = allUsers.some(u => u.bowlerId === id);
    
    sendSuccess(res, { ...bowler, hasAccount });
  } catch (error) {
    console.error('[Bowlers] Error fetching bowler:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch bowler');
  }
});

router.post("/", async (req, res) => {
  try {
    const bowler = insertBowlerSchema.parse(req.body);
    
    // If teamId is provided in the request, verify organization access
    if (req.body.teamId && !req.user?.isAdmin) {
      const teamId = parseInt(req.body.teamId);
      
      if (!isNaN(teamId)) {
        const hasAccess = await hasAccessToTeam(req, teamId);
        if (!hasAccess) {
          return sendError(res, "You don't have access to add bowlers to this team", 403, 'FORBIDDEN');
        }
      }
    }

    // Check for existing bowler with same email if provided
    if (bowler.email) {
      const existingBowlers = await storage.getBowlers();
      
      // If user is not admin and belongs to an organization, filter existing bowlers by organization
      let filteredBowlers = existingBowlers;
      if (!req.user?.isAdmin && req.user?.organizationId) {
        const [leagues, bowlerLeagues] = await Promise.all([
          storage.getLeagues(req.user.organizationId),
          storage.getBowlerLeagues(),
        ]);
        if (leagues && leagues.length > 0) {
          const leagueIdSet = new Set(leagues.map(l => l.id));
          const organizationBowlerIds = new Set(
            bowlerLeagues
              .filter(bl => leagueIdSet.has(bl.leagueId))
              .map(bl => bl.bowlerId)
          );
          filteredBowlers = existingBowlers.filter(b => organizationBowlerIds.has(b.id));
        }
      }
      
      const existingBowler = filteredBowlers.find(b =>
        b.email && b.email.toLowerCase() === bowler.email!.toLowerCase()
      );

      if (existingBowler) {
        return res.status(200).json({
          success: true,
          duplicate: true,
          existingBowler: {
            id: existingBowler.id,
            name: existingBowler.name,
            email: existingBowler.email,
          },
        });
      }
    }

    // Create bowler in database first
    const created = await storage.createBowler(bowler);

    if (created.email) {
      try {
        const matchingUser = await storage.getUserByEmail(created.email);
        if (matchingUser && !matchingUser.bowlerId) {
          await storage.linkUserToBowler(matchingUser.id, created.id);
          console.log(`[Bowlers] Auto-linked user ${matchingUser.id} to newly created bowler ${created.id}`);
          const bowlerLeagues = await storage.getBowlerLeagues(created.id);
          if (bowlerLeagues.length > 0) {
            const league = await storage.getLeague(bowlerLeagues[0].leagueId);
            if (league?.organizationId && !matchingUser.organizationId) {
              await storage.setUserOrganization(matchingUser.id, league.organizationId);
              console.log(`[Bowlers] Set user ${matchingUser.id} organization to ${league.organizationId}`);
            }
          }
        }
      } catch (linkError) {
        console.error('[Bowlers] Error auto-linking user to bowler:', linkError);
      }

      try {
        const squareCustomer = await createOrUpdateCustomer(created.name, created.email);

        if (squareCustomer) {
          const updated = await storage.updateBowler(created.id, {
            ...created,
            squareCustomerId: squareCustomer.id,
            active: true
          });
          if (isBNConfigured()) {
            syncBowlerToBN(updated.id).catch(e => console.error('[Bowlers] BowlNow sync error:', e));
          }
          return sendSuccess(res, updated, 201);
        }
      } catch (squareError) {
        console.error('[Bowlers] Square API error:', squareError);
      }
    }

    if (isBNConfigured()) {
      syncBowlerToBN(created.id).catch(e => console.error('[Bowlers] BowlNow sync error:', e));
    }
    sendSuccess(res, created, 201);
  } catch (error) {
    console.error('[Bowlers] Error creating bowler:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error.errors.map(e => e.message).join(', '), 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to create bowler');
    }
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const update = partialBowlerSchema.parse(req.body);

    const bowler = await storage.getBowler(id);
    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }
    
    // Check organization access
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToBowler(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to update this bowler", 403, 'FORBIDDEN');
      }
    }

    const merged = { ...bowler, ...update };
    let updated = await storage.updateBowler(id, merged);

    if (updated.email) {
      const emailChanged = !bowler.email || bowler.email.toLowerCase() !== updated.email.toLowerCase();

      if (emailChanged) {
        try {
          const matchingUser = await storage.getUserByEmail(updated.email);
          if (matchingUser && !matchingUser.bowlerId) {
            await storage.linkUserToBowler(matchingUser.id, id);
            console.log(`[Bowlers] Auto-linked user ${matchingUser.id} to updated bowler ${id}`);
          }
        } catch (linkError) {
          console.error('[Bowlers] Error auto-linking user to bowler on update:', linkError);
        }
      }

      const nameChanged = bowler.name !== updated.name;
      const needsSquareSync = !updated.squareCustomerId || emailChanged || nameChanged;

      if (needsSquareSync) {
        try {
          const squareCustomer = await createOrUpdateCustomer(updated.name, updated.email);
          if (squareCustomer && squareCustomer.id !== updated.squareCustomerId) {
            updated = await storage.updateBowler(id, {
              ...updated,
              squareCustomerId: squareCustomer.id,
            });
          }
        } catch (squareError) {
          console.error('[Bowlers] Square customer sync error on update:', squareError);
        }
      }
    }

    if (isBNConfigured()) {
      syncBowlerToBN(updated.id).catch(e => console.error('[Bowlers] BowlNow sync error:', e));
    }
    sendSuccess(res, updated);
  } catch (error) {
    console.error('[Bowlers] Error updating bowler:', error);
    if (error instanceof z.ZodError) {
      sendError(res, error.errors.map(e => e.message).join(', '), 400);
    } else {
      sendError(res, error instanceof Error ? error.message : 'Failed to update bowler');
    }
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const bowler = await storage.getBowler(id);
    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }
    
    // Check organization access
    if (!req.user?.isAdmin) {
      const hasAccess = await hasAccessToBowler(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to delete this bowler", 403, 'FORBIDDEN');
      }
    }

    await storage.deleteBowler(id);
    sendSuccess(res, null, 204);
  } catch (error) {
    console.error('[Bowlers] Error deleting bowler:', error);
    sendError(res,
      error instanceof Error ?
        `Failed to delete bowler: ${error.message}` :
        'Internal server error',
      500
    );
  }
});

export default router;