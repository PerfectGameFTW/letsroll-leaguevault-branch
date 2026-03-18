import { Router } from 'express';
import { storage } from '../storage.js';
import { insertPaymentScheduleSchema } from '@shared/schema.js';
import { sendSuccess, sendError } from '../utils/api.js';
import { hasAccessToLeague, hasAccessToBowler } from '../utils/access-control.js';
import { paymentScheduler } from '../services/payment-scheduler.js';
import { addMonths, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { adminWriteLimiter } from '../middleware/rate-limit.js';
import { getNextLeagueDateTime } from '../utils/league-datetime.js';

const router = Router();

router.post('/', adminWriteLimiter, async (req, res) => {
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

    const isUpfrontFrequency = req.body.frequency === 'upfront';
    const nextPaymentDate = isUpfrontFrequency
      ? new Date()
      : getNextLeagueDateTime(
          new Date(),
          league.weekDay,
          league.competitionStartTime,
          league.timezone ?? 'America/Chicago'
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

    const league = await storage.getLeague(leagueId);
    return sendSuccess(res, {
      ...schedule,
      leagueTimezone: league?.timezone ?? 'America/Chicago',
    });
  } catch (error) {
    console.error('[PaymentSchedules] Error fetching schedule:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

router.delete('/:id', adminWriteLimiter, async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid schedule ID', 400, 'INVALID_ID');
    }

    const schedule = await storage.getPaymentScheduleById(id);
    if (!schedule) {
      return sendError(res, 'Payment schedule not found', 404, 'NOT_FOUND');
    }

    if (!await hasAccessToBowler(req, schedule.bowlerId)) {
      return sendError(res, "You don't have access to this schedule", 403, 'FORBIDDEN');
    }

    await storage.deactivatePaymentSchedule(id);
    await paymentScheduler.removeSchedule(id);

    return sendSuccess(res, { message: 'Payment schedule cancelled' });
  } catch (error) {
    console.error('[PaymentSchedules] Error cancelling schedule:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

router.patch('/:id', adminWriteLimiter, async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return sendError(res, 'Authentication required', 401, 'AUTH_REQUIRED');
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(res, 'Invalid schedule ID', 400, 'INVALID_ID');
    }

    const schedule = await storage.getPaymentScheduleById(id);
    if (!schedule || !schedule.active) {
      return sendError(res, 'Active payment schedule not found', 404, 'NOT_FOUND');
    }

    if (!await hasAccessToBowler(req, schedule.bowlerId)) {
      return sendError(res, "You don't have access to this schedule", 403, 'FORBIDDEN');
    }

    const { frequency } = req.body;
    if (frequency && !['weekly', 'monthly', 'upfront'].includes(frequency)) {
      return sendError(res, 'Frequency must be "weekly", "monthly", or "upfront"', 400, 'VALIDATION_ERROR');
    }

    const updates: Record<string, any> = {};

    if (frequency && frequency !== schedule.frequency) {
      const league = await storage.getLeague(schedule.leagueId);
      if (!league) {
        return sendError(res, 'League not found', 404, 'LEAGUE_NOT_FOUND');
      }

      updates.frequency = frequency;

      const weeklyFee = league.weeklyFee || 0;
      updates.amount = frequency === 'monthly' ? weeklyFee * 4 : weeklyFee;

      updates.nextPaymentDate = getNextLeagueDateTime(
        new Date(),
        league.weekDay,
        league.competitionStartTime,
        league.timezone ?? 'America/Chicago'
      );
    }

    if (Object.keys(updates).length === 0) {
      return sendSuccess(res, schedule);
    }

    const updated = await storage.updatePaymentScheduleFields(id, updates);
    await paymentScheduler.updateSchedule(updated);

    return sendSuccess(res, updated);
  } catch (error) {
    console.error('[PaymentSchedules] Error updating schedule:', error);
    return sendError(res, 'Internal server error', 500, 'SERVER_ERROR');
  }
});

export default router;
