import { Router } from 'express';
import { storage } from '../storage.js';
import { insertPaymentScheduleSchema } from '@shared/schema.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { hasAccessToLeague, hasAccessToBowler } from '../utils/access-control.js';
import { paymentScheduler } from '../services/payment-scheduler.js';
import { addWeeks, addMonths, nextDay, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';

const WEEKDAY_MAP: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function getNextLeagueDateTime(
  afterDate: Date,
  weekDay: string,
  competitionStartTime: string | null | undefined
): Date {
  const [hours, minutes] = competitionStartTime
    ? competitionStartTime.split(':').map(Number)
    : [12, 0];

  const dayIndex = WEEKDAY_MAP[weekDay];
  if (dayIndex === undefined) {
    return addWeeks(afterDate, 1);
  }

  let target = nextDay(afterDate, dayIndex);
  target = setHours(target, hours);
  target = setMinutes(target, minutes);
  target = setSeconds(target, 0);
  target = setMilliseconds(target, 0);

  return target;
}

const router = Router();

router.post('/', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
    }

    if (!await hasAccessToLeague(req, req.body.leagueId)) {
      return sendError(res, "You don't have access to this league", 403, 'FORBIDDEN');
    }

    if (!await hasAccessToBowler(req, req.body.bowlerId)) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const existing = await storage.getPaymentSchedule(req.body.bowlerId, req.body.leagueId);
    if (existing) {
      return sendError(res, 'An active payment schedule already exists for this bowler and league', 400, 'SCHEDULE_EXISTS');
    }

    const league = await storage.getLeague(req.body.leagueId);
    if (!league) {
      return sendError(res, 'League not found', 404, 'LEAGUE_NOT_FOUND');
    }

    const nextPaymentDate = getNextLeagueDateTime(
      new Date(),
      league.weekDay,
      league.competitionStartTime
    );

    const validationResult = insertPaymentScheduleSchema.safeParse({
      ...req.body,
      nextPaymentDate,
    });

    if (!validationResult.success) {
      const msg = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return sendError(res, msg, 400, 'VALIDATION_ERROR');
    }

    const schedule = await storage.createPaymentSchedule(validationResult.data);

    await paymentScheduler.addSchedule(schedule, league.organizationId);

    return sendSuccess(res, schedule, 201);
  } catch (error) {
    console.error('[PaymentSchedules] Error creating schedule:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

router.get('/:bowlerId/:leagueId', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
    }

    const bowlerId = parseInt(req.params.bowlerId, 10);
    const leagueId = parseInt(req.params.leagueId, 10);

    if (isNaN(bowlerId) || isNaN(leagueId)) {
      return sendError(res, 'Invalid bowler or league ID', 400, 'INVALID_ID');
    }

    if (!await hasAccessToBowler(req, bowlerId)) {
      return sendError(res, "You don't have access to this bowler", 403, 'FORBIDDEN');
    }

    const schedule = await storage.getPaymentSchedule(bowlerId, leagueId);
    if (!schedule) {
      return sendError(res, 'No active payment schedule found', 404, 'NOT_FOUND');
    }

    return sendSuccess(res, schedule);
  } catch (error) {
    console.error('[PaymentSchedules] Error fetching schedule:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

export default router;
