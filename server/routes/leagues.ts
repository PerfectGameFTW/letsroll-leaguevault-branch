import { Router } from 'express';
import { randomBytes } from 'crypto';
import { storage } from '../storage';
import { insertLeagueSchema, partialLeagueSchema } from "@shared/schema";
import { z } from "zod";
import { sendSuccess, sendError } from '../utils/api';
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
    
    if (!requireOrganizationAccess(req, league.organizationId, 'league', id)) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }
    
    sendSuccess(res, league);
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch league');
  }
});

router.post("/", async (req: any, res) => {
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

    // Parse league data
    const league = insertLeagueSchema.parse({
      ...req.body,
      seasonStart: new Date(req.body.seasonStart),
      seasonEnd: derivedSeasonEnd ?? new Date(req.body.seasonEnd)
    });
    
    const organizationId = getOrganizationFilter(req);

    if (organizationId !== null && !league.organizationId) {
      league.organizationId = organizationId;
    } else if (!league.organizationId) {
      if (req.user?.role === 'system_admin') {
        if (!req.body.globalAccess) {
          return sendError(
            res,
            'An organizationId is required. To create a globally accessible league, set globalAccess: true in the request body.',
            400,
            'ORG_REQUIRED'
          );
        }
        league.organizationId = null;
      } else {
        if (!req.user?.organizationId) {
          return sendError(
            res,
            'You must belong to an organization to create a league.',
            403,
            'ORG_REQUIRED'
          );
        }
        league.organizationId = req.user.organizationId;
      }
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

    const update = partialLeagueSchema.parse({
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
          console.log(`[Leagues Route] Backfilled payment splits for league ${id}: lineageFee=${lineageFee}, prizeFundFee=${prizeFundFee}`);
        } else {
          await db.execute(sql`
            UPDATE payments
            SET lineage_amount = NULL, prize_fund_amount = NULL
            WHERE league_id = ${id}
          `);
          console.log(`[Leagues Route] Cleared payment splits for league ${id} (fees not fully configured)`);
        }
      } catch (backfillErr) {
        console.error('[Leagues Route] Error backfilling payment splits:', backfillErr);
      }
    }

    const timezoneChanged = update.timezone && update.timezone !== league.timezone;
    if (timezoneChanged) {
      const activeSchedules = await storage.getActiveSchedulesByLeague(id);
      const tz = updated.timezone ?? 'America/Chicago';

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
    if (!requireOrganizationAccess(req, league.organizationId, 'league', id)) {
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
    if (!requireOrganizationAccess(req, league.organizationId, 'league', id)) {
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
    
    if (!requireOrganizationAccess(req, league.organizationId, 'league', id)) {
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
      await sendInviteEmail(bowler.email, firstName, inviteToken, organization?.name, organization?.id);

      sent++;
    }

    sendSuccess(res, { sent, alreadyRegistered, noEmail });
  } catch (error) {
    sendError(res, error instanceof Error ? error.message : 'Failed to send invites');
  }
});

router.post("/:id/new-season", async (req: any, res) => {
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
      seasonStart: newSeasonStart.toISOString(),
      seasonEnd: newSeasonEnd.toISOString(),
      weekDay: sourceLeague.weekDay,
      weeklyFee: sourceLeague.weeklyFee,
      lineageFee: sourceLeague.lineageFee ?? undefined,
      prizeFundFee: sourceLeague.prizeFundFee ?? undefined,
      practiceStartTime: sourceLeague.practiceStartTime ?? undefined,
      competitionStartTime: sourceLeague.competitionStartTime ?? undefined,
      timezone: sourceLeague.timezone ?? "America/Chicago",
      squareLineageItemId: sourceLeague.squareLineageItemId,
      squareLineageItemVariationId: sourceLeague.squareLineageItemVariationId,
      squareLineageItemName: sourceLeague.squareLineageItemName,
      squarePrizeFundItemId: sourceLeague.squarePrizeFundItemId,
      squarePrizeFundItemVariationId: sourceLeague.squarePrizeFundItemVariationId,
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
    console.error('[Leagues Route] New season error:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to create new season');
  }
});

router.get("/:id/season-history", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, "Invalid league ID", 400, "INVALID_ID");
    }

    const league = await storage.getLeague(id);
    if (!league) {
      return sendError(res, "League not found", 404, "NOT_FOUND");
    }

    const allLeagues = await storage.getLeagues(league.organizationId || undefined);
    const seasons: any[] = [];

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
    sendError(res, error instanceof Error ? error.message : 'Failed to fetch season history');
  }
});

export default router;
