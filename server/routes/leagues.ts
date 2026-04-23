import { Router, Request } from 'express';
import { randomBytes } from 'crypto';
import { storage } from '../storage';
import { insertLeagueSchema, updateLeagueSchema, DEFAULT_TIMEZONE } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError, handleZodError } from '../utils/api';
import { requireOrganizationAccess } from '../utils/access-control';
import { getOrganizationFilter, filterByOrganization } from '../middleware/organization';
import { hashPassword } from '../auth';
import { sendInviteEmail } from '../services/email';
import { paymentScheduler } from '../services/payment-scheduler.js';
import { getNextLeagueDateTime } from '../utils/league-datetime.js';
import { calculateSeasonEnd } from '@shared/schedule-utils';
import { db } from '../db.js';
import { payments as paymentsTable } from '@shared/schema';
import { eq, isNull, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { createLogger } from '../logger';

const log = createLogger("Leagues");

const router = Router();

// Apply organization filtering to all league routes
router.use(filterByOrganization);

router.get("/", async (req: Request, res) => {
  try {
    const organizationId = getOrganizationFilter(req);
    const isSystemAdmin = req.user?.role === 'system_admin';
    
    let leagues: Awaited<ReturnType<typeof storage.getLeagues>>;
    if (organizationId !== null) {
      leagues = await storage.getLeagues(organizationId);
    } else if (isSystemAdmin) {
      leagues = await storage.getAllLeaguesSystemAdmin();
    } else {
      return sendSuccess(res, []);
    }
    
    const locationId = req.query.locationId ? parseInt(String(req.query.locationId)) : null;
    if (locationId) {
      leagues = leagues.filter(l => l.locationId === locationId);
    }
    
    sendSuccess(res, leagues);
  } catch (error) {
    sendError(res, 'Failed to fetch leagues');
  }
});

router.get("/:id", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id);
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    if (!requireOrganizationAccess(req, league.organizationId, 'league', id)) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    sendSuccess(res, league);
  } catch (error) {
    sendError(res, 'Failed to fetch league');
  }
});

router.post("/", async (req: Request, res) => {
  try {
    // Derive seasonEnd server-side when totalBowlingWeeks is provided
    let derivedSeasonEnd = req.body.seasonEnd ? new Date(req.body.seasonEnd) : undefined;
    if (
      req.body.totalBowlingWeeks != null &&
      req.body.seasonStart &&
      req.body.weekDay
    ) {
      derivedSeasonEnd = calculateSeasonEnd(
        new Date(req.body.seasonStart),
        req.body.weekDay,
        Number(req.body.totalBowlingWeeks),
        req.body.skipDates ?? [],
        req.body.cancelledDates ?? []
      );
    }

    // Determine the effective organizationId BEFORE parsing — the insert
    // schema now requires a non-null org, so server-side fallbacks must be
    // applied to the payload first or normal org_admin form submissions
    // (which don't include an organizationId field) would fail validation.
    const filterOrg = getOrganizationFilter(req);
    const bodyOrg = typeof req.body?.organizationId === 'number' ? req.body.organizationId : null;
    let effectiveOrgId: number | null = bodyOrg ?? filterOrg ?? req.user?.organizationId ?? null;

    if (effectiveOrgId == null) {
      // Every league must belong to an organization. system_admin used to
      // be able to create a "globally accessible" (org-less) league via
      // globalAccess: true; that path created rows that are unreachable
      // under the deny-on-null access policy and is no longer permitted.
      if (req.user?.role === 'system_admin') {
        return sendError(
          res,
          'An organizationId is required. System admins must specify the target organization when creating a league.',
          400,
          'ORG_REQUIRED'
        );
      }
      return sendError(
        res,
        'You must belong to an organization to create a league.',
        403,
        'ORG_REQUIRED'
      );
    }

    const league = insertLeagueSchema.parse({
      ...req.body,
      organizationId: effectiveOrgId,
      seasonStart: new Date(req.body.seasonStart),
      seasonEnd: derivedSeasonEnd ?? new Date(req.body.seasonEnd)
    });

    const created = await storage.createLeague(league);
    sendSuccess(res, created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    sendError(res, 'Failed to create league');
  }
});

router.patch("/:id", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get the league to verify organization access
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    if (!requireOrganizationAccess(req, league.organizationId, 'league', id)) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    // Non-admin users cannot change the organization of a league
    if (req.user?.role !== 'system_admin' && req.body.organizationId !== undefined) {
      return sendError(res, "You don't have permission to change the organization of this league", 403, 'FORBIDDEN');
    }
    
    // Merge incoming fields with existing league data for derivation
    const mergedWeekDay = req.body.weekDay ?? league.weekDay;
    const mergedSeasonStart = req.body.seasonStart ?? league.seasonStart;
    const mergedTotalBowlingWeeks = req.body.totalBowlingWeeks !== undefined
      ? req.body.totalBowlingWeeks
      : league.totalBowlingWeeks;
    const mergedSkipDates = req.body.skipDates ?? league.skipDates ?? [];
    const mergedCancelledDates = req.body.cancelledDates ?? league.cancelledDates ?? [];

    // Derive seasonEnd server-side when totalBowlingWeeks is available
    let derivedSeasonEnd = req.body.seasonEnd ? new Date(req.body.seasonEnd) : undefined;
    if (mergedTotalBowlingWeeks != null && mergedSeasonStart && mergedWeekDay) {
      derivedSeasonEnd = calculateSeasonEnd(
        new Date(mergedSeasonStart),
        mergedWeekDay,
        Number(mergedTotalBowlingWeeks),
        mergedSkipDates,
        mergedCancelledDates
      );
    }

    const update = updateLeagueSchema.parse({
      ...req.body,
      seasonStart: req.body.seasonStart ? new Date(req.body.seasonStart) : undefined,
      seasonEnd: derivedSeasonEnd ?? (req.body.seasonEnd ? new Date(req.body.seasonEnd) : undefined)
    });
    
    const updated = await storage.updateLeague(id, update);

    const feesChanged = update.lineageFee !== undefined || update.prizeFundFee !== undefined;
    if (feesChanged) {
      try {
        const lineageFee = updated.lineageFee;
        const prizeFundFee = updated.prizeFundFee;
        const weeklyFee = updated.weeklyFee;
        const bothSet = lineageFee != null && prizeFundFee != null;
        const sumMatchesWeekly = bothSet && (lineageFee + prizeFundFee === weeklyFee);

        if (bothSet && sumMatchesWeekly && weeklyFee > 0) {
          await db.execute(sql`
            UPDATE payments
            SET
              lineage_amount = ROUND(amount::numeric * ${lineageFee} / ${weeklyFee})::integer,
              prize_fund_amount = ROUND(amount::numeric * ${prizeFundFee} / ${weeklyFee})::integer
            WHERE league_id = ${id}
              AND status = 'paid'
          `);
          log.info(`Backfilled payment splits for league ${id}: lineageFee=${lineageFee}, prizeFundFee=${prizeFundFee}`);
        } else {
          await db.execute(sql`
            UPDATE payments
            SET lineage_amount = NULL, prize_fund_amount = NULL
            WHERE league_id = ${id}
          `);
          log.info(`Cleared payment splits for league ${id} (fees not fully configured)`);
        }
      } catch (backfillErr) {
        log.error('Error backfilling payment splits:', backfillErr);
      }
    }

    const timezoneChanged = update.timezone && update.timezone !== league.timezone;
    if (timezoneChanged) {
      const activeSchedules = await storage.getActiveSchedulesByLeague(id);
      const tz = updated.timezone ?? DEFAULT_TIMEZONE;

      for (const sched of activeSchedules) {
        const nextDate = getNextLeagueDateTime(
          new Date(),
          updated.weekDay,
          updated.competitionStartTime,
          tz,
          updated.skipDates ?? [],
          updated.cancelledDates ?? []
        );

        await storage.updatePaymentScheduleFields(sched.id, { nextPaymentDate: nextDate.toISOString() });
        await paymentScheduler.removeSchedule(sched.id);
        const updatedSched = await storage.getPaymentScheduleById(sched.id);
        if (updatedSched && updatedSched.active) {
          await paymentScheduler.addSchedule(updatedSched, updated.organizationId);
        }
      }
    }

    sendSuccess(res, updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleZodError(res, error);
    }
    sendError(res, 'Failed to update league');
  }
});

// Archive a league
router.patch("/:id/archive", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id);
    const league = await storage.getLeague(id);
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    if (!requireOrganizationAccess(req, league.organizationId, 'league', id)) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    const archived = await storage.archiveLeague(id);
    sendSuccess(res, archived);
  } catch (error) {
    sendError(res, 'Failed to archive league');
  }
});

// Restore an archived league
router.patch("/:id/restore", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id);
    const league = await storage.getLeague(id);
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    if (!requireOrganizationAccess(req, league.organizationId, 'league', id)) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    const restored = await storage.restoreLeague(id);
    sendSuccess(res, restored);
  } catch (error) {
    sendError(res, 'Failed to restore league');
  }
});

router.delete("/:id", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Get the league to verify organization access
    const league = await storage.getLeague(id);
    
    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }
    
    if (!requireOrganizationAccess(req, league.organizationId, 'league', id)) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    const teams = await storage.getTeams(id);

    for (const team of teams) {
      const teamBowlers = await storage.getBowlers({ teamId: team.id, organizationId: league.organizationId! });
      for (const bowler of teamBowlers) {
        await storage.updateBowler(bowler.id, { active: false, order: 0 });
      }
      await storage.deleteTeam(team.id);
    }

    await storage.deleteLeague(id);
    sendSuccess(res, null, 204);
  } catch (error) {
    sendError(res, 'Failed to delete league');
  }
});

router.post("/:id/send-invites", async (req: Request, res) => {
  try {
    const leagueId = parseInt(req.params.id);
    const league = await storage.getLeague(leagueId);

    if (!league) {
      return sendError(res, "League not found", 404, 'NOT_FOUND');
    }

    if (!requireOrganizationAccess(req, league.organizationId, 'league', leagueId)) {
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
        role: 'user',
        organizationId: league.organizationId || null,
      });

      await storage.setUserInviteToken(newUser.id, inviteToken, inviteTokenExpiry);
      await storage.linkUserToBowler(newUser.id, bowler.id);

      const organization = league.organizationId
        ? await storage.getOrganization(league.organizationId)
        : null;

      const firstName = bowler.name.split(' ')[0];
      await sendInviteEmail(bowler.email, firstName, inviteToken, organization?.name, organization?.id, organization?.slug);

      sent++;
    }

    sendSuccess(res, { sent, alreadyRegistered, noEmail });
  } catch (error) {
    sendError(res, 'Failed to send invites');
  }
});

router.post("/:id/new-season", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid league ID", 400, "INVALID_ID");
    }

    if (req.user?.role !== 'system_admin' && req.user?.role !== 'org_admin') {
      return sendError(res, "Only admins can start a new season", 403, "FORBIDDEN");
    }

    const sourceLeague = await storage.getLeague(id);
    if (!sourceLeague) {
      return sendError(res, "League not found", 404, "NOT_FOUND");
    }

    // Authz: cloning a league counts as a write against the source league's
    // organization. Without this check an org_admin could create a new
    // season on any league by ID, regardless of which org owns it.
    if (!requireOrganizationAccess(req, sourceLeague.organizationId, 'league', id)) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    const { seasonStart, seasonEnd } = req.body;
    if (!seasonStart || !seasonEnd) {
      return sendError(res, "Season start and end dates are required", 400, "VALIDATION_ERROR");
    }

    const newSeasonStart = new Date(seasonStart);
    const newSeasonEnd = new Date(seasonEnd);
    if (newSeasonEnd <= newSeasonStart) {
      return sendError(res, "Season end date must be after start date", 400, "VALIDATION_ERROR");
    }

    const newLeague = await storage.createLeague({
      name: sourceLeague.name,
      description: sourceLeague.description,
      active: true,
      allowPublicSignup: sourceLeague.allowPublicSignup ?? false,
      seasonStart: newSeasonStart.toISOString(),
      seasonEnd: newSeasonEnd.toISOString(),
      weekDay: sourceLeague.weekDay,
      weeklyFee: sourceLeague.weeklyFee,
      lineageFee: sourceLeague.lineageFee ?? undefined,
      prizeFundFee: sourceLeague.prizeFundFee ?? undefined,
      practiceStartTime: sourceLeague.practiceStartTime ?? undefined,
      competitionStartTime: sourceLeague.competitionStartTime ?? undefined,
      timezone: sourceLeague.timezone ?? DEFAULT_TIMEZONE,
      squareLineageItemId: sourceLeague.squareLineageItemId,
      lineageItemVariationId: sourceLeague.lineageItemVariationId,
      squareLineageItemName: sourceLeague.squareLineageItemName,
      squarePrizeFundItemId: sourceLeague.squarePrizeFundItemId,
      prizeFundItemVariationId: sourceLeague.prizeFundItemVariationId,
      squarePrizeFundItemName: sourceLeague.squarePrizeFundItemName,
      squareCategoryId: sourceLeague.squareCategoryId ?? undefined,
      finalTwoWeeksDueWeek: sourceLeague.finalTwoWeeksDueWeek,
      paymentMode: sourceLeague.paymentMode ?? "weekly",
      organizationId: sourceLeague.organizationId,
      locationId: sourceLeague.locationId,
      seasonNumber: (sourceLeague.seasonNumber || 1) + 1,
      previousSeasonId: sourceLeague.id,
      totalBowlingWeeks: sourceLeague.totalBowlingWeeks,
      skipDates: [],
      cancelledDates: [],
    });

    const sourceTeams = await storage.getTeams(sourceLeague.id);
    const teamIdMap = new Map<number, number>();

    for (const team of sourceTeams) {
      const newTeam = await storage.createTeam({
        name: team.name,
        number: team.number,
        leagueId: newLeague.id,
        active: team.active,
      });
      teamIdMap.set(team.id, newTeam.id);
    }

    const sourceBowlerLeagues = await storage.getBowlerLeagues({ leagueId: sourceLeague.id });

    for (const bl of sourceBowlerLeagues) {
      const newTeamId = teamIdMap.get(bl.teamId);
      if (newTeamId) {
        await storage.createBowlerLeague({
          bowlerId: bl.bowlerId,
          leagueId: newLeague.id,
          teamId: newTeamId,
          active: bl.active,
          order: bl.order,
        });
      }
    }

    await storage.updateLeague(sourceLeague.id, { active: false });

    sendSuccess(res, newLeague, 201);
  } catch (error) {
    log.error('New season error:', error);
    sendError(res, 'Failed to create new season');
  }
});

router.get("/:id/season-history", async (req: Request, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid league ID", 400, "INVALID_ID");
    }

    const league = await storage.getLeague(id);
    if (!league) {
      return sendError(res, "League not found", 404, "NOT_FOUND");
    }

    let allLeagues;
    if (league.organizationId) {
      allLeagues = await storage.getLeagues(league.organizationId);
    } else if (req.user?.role === 'system_admin') {
      allLeagues = await storage.getAllLeaguesSystemAdmin();
    } else {
      allLeagues = [league];
    }
    const seasons: typeof league[] = [];

    let current: typeof league | undefined = league;
    while (current?.previousSeasonId) {
      current = allLeagues.find(l => l.id === current!.previousSeasonId);
      if (current) seasons.unshift(current);
    }

    seasons.push(league);

    const nextSeason = allLeagues.find(l => l.previousSeasonId === league.id);
    if (nextSeason) {
      let next: typeof nextSeason | undefined = nextSeason;
      while (next) {
        seasons.push(next);
        next = allLeagues.find(l => l.previousSeasonId === next!.id);
      }
    }

    sendSuccess(res, seasons);
  } catch (error) {
    sendError(res, 'Failed to fetch season history');
  }
});

export default router;
