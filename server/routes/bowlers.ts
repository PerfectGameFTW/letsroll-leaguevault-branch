import { Router } from 'express';
import { storage } from '../storage';
import { insertBowlerSchema, updateBowlerSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError, handleZodError } from '../utils/api.js';
import { createOrUpdateCustomer } from '../services/square.js';
import { hasAccessToTeam, hasAccessToBowler } from '../utils/access-control.js';
import { syncBowlerToBN, isOrgBNConfigured } from '../services/bowlnow.js';
import { createLogger } from '../logger';

const log = createLogger("Bowlers");

const router = Router();

router.use((req: any, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return sendError(res, "Authentication required", 401, 'UNAUTHORIZED');
  }
  next();
});

router.get("/unlinked", async (req: any, res) => {
  try {
    const rawUnlinkedOrgId = req.query.organizationId ? parseInt(req.query.organizationId as string) : undefined;
    if (rawUnlinkedOrgId !== undefined && isNaN(rawUnlinkedOrgId)) {
      return sendError(res, "Invalid organization ID format", 400);
    }

    let organizationId: number | undefined;
    if (req.user?.role === 'system_admin') {
      // System admins may scope by query param, or see all if omitted
      organizationId = rawUnlinkedOrgId;
    } else if (req.user?.role === 'org_admin') {
      // Org admins are always scoped to their own organization
      if (!req.user?.organizationId) {
        return sendError(res, "No organization context available", 403, 'FORBIDDEN');
      }
      organizationId = req.user.organizationId;
    } else {
      // Regular users must have an org
      if (!req.user?.organizationId) {
        return sendError(res, "No organization context available", 403, 'FORBIDDEN');
      }
      organizationId = req.user.organizationId;
    }
    let scopedBowlers;
    if (req.user?.role === 'system_admin' && !organizationId) {
      scopedBowlers = await storage.getAllBowlersSystemAdmin();
    } else if (organizationId) {
      scopedBowlers = await storage.getBowlers({ organizationId });
    } else {
      return sendSuccess(res, []);
    }

    const linkedBowlerIdsList = await storage.getLinkedBowlerIds();
    const linkedBowlerIds = new Set(linkedBowlerIdsList);

    const unlinkedBowlers = scopedBowlers.filter(
      b => !linkedBowlerIds.has(b.id) && (!b.email || b.email.trim() === '')
    );

    const bowlerIds = unlinkedBowlers.map(b => b.id);
    const bowlerLeagueEntries = bowlerIds.length > 0
      ? await storage.getBowlerLeaguesByBowlerIds(bowlerIds)
      : [];

    const leagueIds = [...new Set(bowlerLeagueEntries.map(bl => bl.leagueId))];
    const teamIds = [...new Set(bowlerLeagueEntries.map(bl => bl.teamId))];

    const [leaguesData, teamsData] = await Promise.all([
      leagueIds.length > 0 ? storage.getLeaguesByIds(leagueIds) : Promise.resolve([]),
      teamIds.length > 0 ? storage.getTeamsByIds(teamIds) : Promise.resolve([]),
    ]);

    const leagueMap = new Map(leaguesData.map(l => [l.id, l]));
    const teamMap = new Map(teamsData.map(t => [t.id, t]));

    const grouped: Record<string, { league: { id: number; name: string }; teams: Record<string, { team: { id: number; name: string; number: number }; bowlers: { id: number; name: string }[] }> }> = {};

    for (const bowler of unlinkedBowlers) {
      const bowlerEntries = bowlerLeagueEntries.filter(bl => bl.bowlerId === bowler.id);
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
    log.error('Error fetching unlinked bowlers:', error);
    sendError(res, 'Failed to fetch unlinked bowlers');
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
    if (teamId && req.user?.role !== 'system_admin') {
      const hasAccess = await hasAccessToTeam(req, teamId);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this team's bowlers", 403, 'FORBIDDEN');
      }
    }

    // Determine the effective organization context
    const isSystemAdmin = req.user?.role === 'system_admin';
    const rawQueryOrgId = req.query.organizationId ? parseInt(req.query.organizationId as string) : undefined;
    if (rawQueryOrgId !== undefined && isNaN(rawQueryOrgId)) {
      return sendError(res, "Invalid organization ID format", 400);
    }
    const effectiveOrgId: number | null = isSystemAdmin
      ? (rawQueryOrgId ?? req.user?.organizationId ?? null)
      : (req.user?.organizationId ?? null);

    if (!teamId && !isSystemAdmin && effectiveOrgId === null) {
      return sendSuccess(res, []);
    }

    let bowlers;
    if (isSystemAdmin && effectiveOrgId === null) {
      bowlers = await storage.getAllBowlersSystemAdmin();
    } else if (effectiveOrgId !== null) {
      bowlers = await storage.getBowlers({ teamId, organizationId: effectiveOrgId });
    } else {
      return sendSuccess(res, []);
    }
    
    if (!bowlers || bowlers.length === 0) {
      return sendSuccess(res, []);
    }

    const filteredBowlers = ids 
      ? bowlers.filter(b => ids.includes(b.id))
      : bowlers;

    const linkedBowlerIds = new Set(await storage.getLinkedBowlerIds());

    const bowlersWithAccountStatus = filteredBowlers.map(b => ({
      ...b,
      hasAccount: linkedBowlerIds.has(b.id),
    }));

    sendSuccess(res, bowlersWithAccountStatus);
  } catch (error) {
    log.error('Error fetching bowlers:', error);
    sendError(res, 'Failed to fetch bowlers');
  }
});

router.get("/:id/details", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const bowler = await storage.getBowler(id);

    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }

    if (req.user?.role !== 'system_admin') {
      const hasAccess = await hasAccessToBowler(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
      }
    }

    const [hasAccount, bowlerLeagues] = await Promise.all([
      storage.isBowlerLinked(id),
      storage.getBowlerLeagues({ bowlerId: id }),
    ]);

    const leagueIds = [...new Set(bowlerLeagues.map(bl => bl.leagueId))];
    const leagues = leagueIds.length > 0
      ? await storage.getLeaguesByIds(leagueIds)
      : [];

    sendSuccess(res, {
      bowler: { ...bowler, hasAccount },
      bowlerLeagues,
      leagues,
    });
  } catch (error) {
    log.error('Error fetching bowler details:', error);
    sendError(res, 'Failed to fetch bowler details');
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
    if (req.user?.role !== 'system_admin') {
      const hasAccess = await hasAccessToBowler(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
      }
    }

    const hasAccount = await storage.isBowlerLinked(id);
    
    sendSuccess(res, { ...bowler, hasAccount });
  } catch (error) {
    log.error('Error fetching bowler:', error);
    sendError(res, 'Failed to fetch bowler');
  }
});

router.post("/", async (req, res) => {
  try {
    const bowler = insertBowlerSchema.parse(req.body);
    
    // If teamId is provided in the request, verify organization access
    if (req.body.teamId && req.user?.role !== 'system_admin') {
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
      const userOrgId: number | undefined = req.user?.organizationId ?? undefined;
      const isOrgUser = req.user?.role !== 'system_admin' && userOrgId !== undefined;
      const [existingBowlers, orgLeagues, bowlerLeaguesList] = await Promise.all([
        isOrgUser ? storage.getBowlers({ organizationId: userOrgId }) : storage.getAllBowlersSystemAdmin(),
        isOrgUser ? storage.getLeagues(userOrgId) : Promise.resolve(null),
        isOrgUser ? storage.getBowlerLeagues() : Promise.resolve(null),
      ]);

      let filteredBowlers = existingBowlers;
      if (isOrgUser && orgLeagues && orgLeagues.length > 0) {
        const leagueIdSet = new Set(orgLeagues.map(l => l.id));
        const organizationBowlerIds = new Set(
          bowlerLeaguesList!
            .filter(bl => leagueIdSet.has(bl.leagueId))
            .map(bl => bl.bowlerId)
        );
        filteredBowlers = existingBowlers.filter(b => organizationBowlerIds.has(b.id));
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
          log.info(`Auto-linked user ${matchingUser.id} to newly created bowler ${created.id}`);
          const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId: created.id });
          if (bowlerLeagues.length > 0) {
            const league = await storage.getLeague(bowlerLeagues[0].leagueId);
            if (league?.organizationId && !matchingUser.organizationId) {
              await storage.setUserOrganization(matchingUser.id, league.organizationId);
              log.info(`Set user ${matchingUser.id} organization to ${league.organizationId}`);
            }
          }
        }
      } catch (linkError) {
        log.error('Error auto-linking user to bowler:', linkError);
      }

      try {
        const orgId = (req as any).user?.organizationId;
        const squareLocation = orgId ? await storage.getFirstSquareConfiguredLocation(orgId) : null;
        if (squareLocation?.id) {
          const squareCustomer = await createOrUpdateCustomer(created.name, created.email, undefined, squareLocation.id);
          if (squareCustomer) {
            const updated = await storage.updateBowler(created.id, {
              ...created,
              squareCustomerId: squareCustomer.id,
              active: true
            });
            if (orgId) {
              const orgConfig = await storage.getOrgIntegrations(orgId);
              if (isOrgBNConfigured(orgConfig)) {
                syncBowlerToBN(updated.id, orgConfig).catch(e => log.error('BowlNow sync error:', e));
              }
            }
            return sendSuccess(res, updated, 201);
          }
        } else {
          log.info('No Square-configured location found for org, skipping customer sync');
        }
      } catch (squareError) {
        log.error('Square API error:', squareError);
      }
    }

    const createOrgId = (req as any).user?.organizationId;
    if (createOrgId) {
      const createOrgConfig = await storage.getOrgIntegrations(createOrgId);
      if (isOrgBNConfigured(createOrgConfig)) {
        syncBowlerToBN(created.id, createOrgConfig).catch(e => log.error('BowlNow sync error:', e));
      }
    }
    sendSuccess(res, created, 201);
  } catch (error) {
    log.error('Error creating bowler:', error);
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    sendError(res, 'Failed to create bowler');
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const update = updateBowlerSchema.parse(req.body);

    const bowler = await storage.getBowler(id);
    if (!bowler) {
      return sendError(res, "Bowler not found", 404, 'NOT_FOUND');
    }
    
    // Check organization access
    if (req.user?.role !== 'system_admin') {
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
            log.info(`Auto-linked user ${matchingUser.id} to updated bowler ${id}`);
          }
        } catch (linkError) {
          log.error('Error auto-linking user to bowler on update:', linkError);
        }
      }

      const nameChanged = bowler.name !== updated.name;
      const needsSquareSync = !updated.squareCustomerId || emailChanged || nameChanged;

      if (needsSquareSync) {
        try {
          const patchOrgId = (req as any).user?.organizationId;
          const patchSquareLocation = patchOrgId ? await storage.getFirstSquareConfiguredLocation(patchOrgId) : null;
          if (patchSquareLocation?.id) {
            const squareCustomer = await createOrUpdateCustomer(updated.name, updated.email, undefined, patchSquareLocation.id);
            if (squareCustomer && squareCustomer.id !== updated.squareCustomerId) {
              updated = await storage.updateBowler(id, {
                ...updated,
                squareCustomerId: squareCustomer.id,
              });
            }
          } else {
            log.info('No Square-configured location found for org, skipping customer sync on update');
          }
        } catch (squareError) {
          log.error('Square customer sync error on update:', squareError);
        }
      }
    }

    const updateOrgId = (req as any).user?.organizationId;
    if (updateOrgId) {
      const updateOrgConfig = await storage.getOrgIntegrations(updateOrgId);
      if (isOrgBNConfigured(updateOrgConfig)) {
        syncBowlerToBN(updated.id, updateOrgConfig).catch(e => log.error('BowlNow sync error:', e));
      }
    }
    sendSuccess(res, updated);
  } catch (error) {
    log.error('Error updating bowler:', error);
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    sendError(res, 'Failed to update bowler');
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
    if (req.user?.role !== 'system_admin') {
      const hasAccess = await hasAccessToBowler(req, id);
      if (!hasAccess) {
        return sendError(res, "You don't have access to delete this bowler", 403, 'FORBIDDEN');
      }
    }

    await storage.deleteBowler(id);
    sendSuccess(res, null, 204);
  } catch (error) {
    log.error('Error deleting bowler:', error);
    sendError(res, 'Failed to delete bowler', 500);
  }
});

export default router;