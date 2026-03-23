import schedule from "node-schedule";
import { db } from "../db";
import { eq, and, lte, isNull } from "drizzle-orm";
import { paymentSchedules, payments, leagues, DEFAULT_TIMEZONE, type PaymentSchedule } from "@shared/schema";
import { addWeeks, addMonths, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { logger } from "../logger";
import { getNextLeagueDateTime } from "../utils/league-datetime.js";
import { storage } from "../storage";
import { isDateSkippedOrCancelled } from "@shared/schedule-utils";
import { executeScheduledPayment, computePaymentSplit } from "./payment-execution";
import { checkAndChargeFinalTwoWeeks, checkPaidInFull } from "./payment-checks";

class PaymentScheduler {
  private jobs: Map<string, schedule.Job> = new Map();

  private async checkLeagueOrgAccess(
    leagueId: number,
    requestedOrgId: number | null,
    context: string
  ): Promise<boolean> {
    const row = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .limit(1);

    if (row.length === 0) {
      logger.error(`[PaymentScheduler] ${context}: league not found`, { leagueId });
      return false;
    }

    const leagueOrgId = row[0].organizationId;

    if (requestedOrgId === null && leagueOrgId !== null) {
      logger.info(`[PaymentScheduler] ${context}: skipping — league belongs to org ${leagueOrgId}`, {
        leagueId, leagueOrgId, requestedOrgId: 'null'
      });
      return false;
    }

    if (requestedOrgId !== null && leagueOrgId !== requestedOrgId) {
      logger.info(`[PaymentScheduler] ${context}: skipping — org mismatch`, {
        leagueId, leagueOrgId, requestedOrgId
      });
      return false;
    }

    return true;
  }

  async initialize(organizationId?: number | null) {
    try {
      this.cancelAllJobs();
      logger.info('[PaymentScheduler] Initializing payment scheduler...', {
        activeJobs: this.jobs.size,
        timestamp: new Date().toISOString(),
        organizationId: organizationId ?? 'all'
      });

      const conditions = [
        eq(paymentSchedules.active, true),
        lte(paymentSchedules.nextPaymentDate, new Date().toISOString()),
      ];

      if (organizationId !== undefined) {
        if (organizationId === null) {
          conditions.push(isNull(leagues.organizationId));
          logger.info('[PaymentScheduler] Filtering for leagues with no organization');
        } else {
          conditions.push(eq(leagues.organizationId, organizationId));
          logger.info(`[PaymentScheduler] Filtering for organization ID: ${organizationId}`);
        }
      }

      const organizationFilteredSchedules = await db
        .select({
          schedule: paymentSchedules,
          leagueOrganizationId: leagues.organizationId
        })
        .from(paymentSchedules)
        .innerJoin(leagues, eq(paymentSchedules.leagueId, leagues.id))
        .where(and(...conditions));

      const activeSchedules = organizationFilteredSchedules.map(item => item.schedule);

      logger.info(`[PaymentScheduler] Found ${activeSchedules.length} active schedules to process`, {
        schedules: activeSchedules.map(s => ({
          id: s.id,
          bowlerId: s.bowlerId,
          leagueId: s.leagueId,
          nextPaymentDate: s.nextPaymentDate,
          amount: s.amount,
          cardId: s.squareCardId ? `${s.squareCardId.substring(0, 10)}...` : 'none',
          isValidCard: s.squareCardId?.startsWith('ccof:'),
          organizationId: organizationFilteredSchedules.find(item => item.schedule.id === s.id)?.leagueOrganizationId ?? null
        }))
      });

      const validSchedules = activeSchedules.filter(s => {
        const isValidCard = s.squareCardId && s.squareCardId.startsWith('ccof:');
        if (!isValidCard) {
          logger.error(`[PaymentScheduler] Invalid card token for schedule ${s.id}`);
        }
        return isValidCard;
      });

      validSchedules.forEach(s => {
        logger.info(`[PaymentScheduler] Scheduling payment for schedule ${s.id}`, {
          amount: s.amount,
          nextPaymentDate: s.nextPaymentDate,
          frequency: s.frequency,
          bowlerId: s.bowlerId,
          leagueId: s.leagueId,
          cardToken: `${s.squareCardId?.substring(0, 10)}...`,
          scheduledAt: new Date().toISOString()
        });
        this.schedulePayment(s);
      });

      const skippedCount = activeSchedules.length - validSchedules.length;
      logger.info(`[PaymentScheduler] Initialization complete`, {
        activated: validSchedules.length,
        skipped: skippedCount,
        totalSchedules: activeSchedules.length,
        completionTime: new Date().toISOString()
      });
    } catch (error) {
      logger.error("[PaymentScheduler] Failed to initialize payment scheduler:", {
        error: error instanceof Error ? {
          name: error.name, message: error.message, stack: error.stack
        } : error,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  private validateCardId(cardId: string | null): boolean {
    if (!cardId) {
      logger.warn('[PaymentScheduler] Missing card token', {
        validationTime: new Date().toISOString()
      });
      return false;
    }
    const isValid = cardId.startsWith('ccof:');
    logger.info('[PaymentScheduler] Card token validation', {
      tokenPrefix: cardId.substring(0, 5),
      isValid,
      validationTime: new Date().toISOString()
    });
    return isValid;
  }

  private schedulePayment(scheduleRecord: PaymentSchedule) {
    const jobId = `payment-${scheduleRecord.id}`;
    const now = new Date();

    if (!this.validateCardId(scheduleRecord.squareCardId)) {
      return;
    }

    logger.info(`[PaymentScheduler] Setting up job ${jobId}`, {
      nextPaymentDate: scheduleRecord.nextPaymentDate,
      currentTime: now,
      timeDifference: new Date(scheduleRecord.nextPaymentDate).getTime() - now.getTime(),
      schedule: {
        id: scheduleRecord.id,
        amount: scheduleRecord.amount,
        frequency: scheduleRecord.frequency,
        bowlerId: scheduleRecord.bowlerId,
        cardToken: `${scheduleRecord.squareCardId?.substring(0, 10)}...`
      }
    });

    this.cancelJob(jobId);

    const job = schedule.scheduleJob(new Date(scheduleRecord.nextPaymentDate), async () => {
      try {
        const claimed = await db
          .update(paymentSchedules)
          .set({ lastPaymentDate: new Date().toISOString() })
          .where(
            and(
              eq(paymentSchedules.id, scheduleRecord.id),
              eq(paymentSchedules.nextPaymentDate, scheduleRecord.nextPaymentDate),
              eq(paymentSchedules.active, true)
            )
          )
          .returning({ id: paymentSchedules.id });

        if (claimed.length === 0) {
          logger.warn(`[PaymentScheduler] Skipping ${jobId} — already claimed by another process or deactivated`);
          return;
        }

        logger.info(`[PaymentScheduler] Executing scheduled payment for ${jobId}`, {
          amount: scheduleRecord.amount,
          bowlerId: scheduleRecord.bowlerId,
          cardToken: `${scheduleRecord.squareCardId?.substring(0, 10)}...`,
          executionTime: new Date().toISOString(),
          scheduledTime: scheduleRecord.nextPaymentDate
        });

        const league = await db.select().from(leagues).where(eq(leagues.id, scheduleRecord.leagueId)).then(r => r[0]);
        const leagueTz = league?.timezone ?? DEFAULT_TIMEZONE;
        const nextPaymentDateObj = new Date(scheduleRecord.nextPaymentDate);
        const firingDateLeagueLocal = league
          ? toZonedTime(nextPaymentDateObj, leagueTz)
          : nextPaymentDateObj;

        if (league && isDateSkippedOrCancelled(
          firingDateLeagueLocal,
          league.skipDates ?? [],
          league.cancelledDates ?? []
        )) {
          const nextDate = getNextLeagueDateTime(
            nextPaymentDateObj,
            league.weekDay,
            league.competitionStartTime,
            leagueTz,
            league.skipDates ?? [],
            league.cancelledDates ?? []
          );
          logger.info(`[PaymentScheduler] Skipping charge on skip/cancelled date for ${jobId}, advancing to ${nextDate.toISOString()}`);
          await storage.updatePaymentScheduleFields(scheduleRecord.id, { nextPaymentDate: nextDate.toISOString() });
          this.schedulePayment({ ...scheduleRecord, nextPaymentDate: nextDate.toISOString() });
          return;
        }

        const paymentResult = await executeScheduledPayment(scheduleRecord, league, jobId);

        if (paymentResult.status === 'success') {
          await this.handleSuccessfulPayment(scheduleRecord, league, paymentResult, jobId);
        } else {
          await this.handleFailedPayment(scheduleRecord, paymentResult, jobId);
        }
      } catch (error) {
        logger.error(`[PaymentScheduler] Critical error processing payment for ${jobId}`, {
          error: error instanceof Error ? {
            name: error.name, message: error.message, stack: error.stack
          } : error,
          schedule: {
            id: scheduleRecord.id,
            bowlerId: scheduleRecord.bowlerId,
            amount: scheduleRecord.amount,
            cardToken: `${scheduleRecord.squareCardId?.substring(0, 10)}...`
          },
          executionTime: new Date().toISOString()
        });
      }
    });

    this.jobs.set(jobId, job);
  }

  private async handleSuccessfulPayment(
    scheduleRecord: PaymentSchedule,
    league: typeof leagues.$inferSelect,
    paymentResult: { paymentId?: string },
    jobId: string
  ) {
    const isUpfrontLeague = league?.paymentMode === 'upfront';
    const tz = league?.timezone ?? DEFAULT_TIMEZONE;
    const currentPaymentDate = new Date(scheduleRecord.nextPaymentDate);

    let nextDate: Date;
    if (scheduleRecord.frequency === 'weekly' && league) {
      nextDate = getNextLeagueDateTime(
        currentPaymentDate,
        league.weekDay,
        league.competitionStartTime,
        tz,
        league.skipDates ?? [],
        league.cancelledDates ?? []
      );
    } else if (scheduleRecord.frequency === 'monthly') {
      nextDate = addMonths(currentPaymentDate, 1);
      if (league?.competitionStartTime) {
        const [h, m] = league.competitionStartTime.split(':').map(Number);
        nextDate = setHours(setMinutes(setSeconds(setMilliseconds(nextDate, 0), 0), m), h);
        nextDate = fromZonedTime(nextDate, tz);
      }
    } else {
      nextDate = addWeeks(currentPaymentDate, 1);
    }

    logger.info(`[PaymentScheduler] Updating schedule ${scheduleRecord.id}`, {
      currentPaymentDate: scheduleRecord.nextPaymentDate,
      nextPaymentDate: nextDate,
      updateTime: new Date().toISOString(),
      frequency: scheduleRecord.frequency
    });

    await db.transaction(async (tx) => {
      await tx
        .update(paymentSchedules)
        .set({
          nextPaymentDate: nextDate.toISOString(),
          lastPaymentDate: scheduleRecord.nextPaymentDate,
        })
        .where(eq(paymentSchedules.id, scheduleRecord.id));

      logger.info(`[PaymentScheduler] Creating payment record for ${jobId}`, {
        paymentId: paymentResult.paymentId,
        recordTime: new Date().toISOString()
      });

      const { lineageAmount, prizeFundAmount } = computePaymentSplit(scheduleRecord.amount, league);
      await tx.insert(payments).values({
        bowlerId: scheduleRecord.bowlerId,
        leagueId: scheduleRecord.leagueId,
        amount: scheduleRecord.amount,
        lineageAmount,
        prizeFundAmount,
        status: 'paid',
        type: 'credit_card',
        weekOf: scheduleRecord.nextPaymentDate,
        squarePaymentId: paymentResult.paymentId,
      });

      logger.info(`[PaymentScheduler] Transaction completed for ${jobId}`, {
        completionTime: new Date().toISOString(),
        nextScheduledDate: nextDate
      });
    });

    if (isUpfrontLeague) {
      logger.info(`[PaymentScheduler] Upfront league — deactivating schedule after payment for ${jobId}`, {
        scheduleId: scheduleRecord.id,
        bowlerId: scheduleRecord.bowlerId,
        leagueId: scheduleRecord.leagueId,
      });
      await storage.deactivatePaymentSchedule(scheduleRecord.id);
      this.cancelJob(jobId);
      return;
    }

    if (league) {
      await checkAndChargeFinalTwoWeeks(scheduleRecord, league, jobId);
    }

    if (league) {
      const paidInFull = await checkPaidInFull(
        scheduleRecord,
        league,
        jobId,
        (id) => this.cancelJob(id)
      );
      if (paidInFull) {
        return;
      }
    }

    logger.info(`[PaymentScheduler] Scheduling next payment for ${jobId}`, {
      nextPaymentDate: nextDate,
      schedulingTime: new Date().toISOString()
    });

    this.schedulePayment({
      ...scheduleRecord,
      nextPaymentDate: nextDate.toISOString(),
    });
  }

  private async handleFailedPayment(
    scheduleRecord: PaymentSchedule,
    paymentResult: { error?: string },
    jobId: string
  ) {
    logger.error(`[PaymentScheduler] Payment failed for ${jobId}`, {
      error: paymentResult.error,
      schedule: {
        id: scheduleRecord.id,
        bowlerId: scheduleRecord.bowlerId,
        amount: scheduleRecord.amount,
        cardToken: `${scheduleRecord.squareCardId?.substring(0, 10)}...`
      },
      failureTime: new Date().toISOString()
    });

    await db.insert(payments).values({
      bowlerId: scheduleRecord.bowlerId,
      leagueId: scheduleRecord.leagueId,
      amount: scheduleRecord.amount,
      status: 'failed',
      type: 'credit_card',
      weekOf: scheduleRecord.nextPaymentDate,
      notes: `Failed payment: ${paymentResult.error}`,
    });
  }

  public cancelAllJobs() {
    const jobCount = this.jobs.size;
    logger.info(`[PaymentScheduler] Cancelling all ${jobCount} scheduled jobs`);
    this.jobs.forEach((job, id) => {
      logger.info(`[PaymentScheduler] Cancelling job ${id}`);
      job.cancel();
    });
    this.jobs.clear();
    logger.info(`[PaymentScheduler] Cancelled ${jobCount} jobs`);
  }

  public cancelJob(jobId: string) {
    if (this.jobs.has(jobId)) {
      logger.info(`[PaymentScheduler] Cancelling job ${jobId}`);
      this.jobs.get(jobId)?.cancel();
      this.jobs.delete(jobId);
      logger.info(`[PaymentScheduler] Job ${jobId} cancelled successfully`);
    } else {
      logger.info(`[PaymentScheduler] No active job found for ${jobId}`);
    }
  }

  async addSchedule(schedule: PaymentSchedule, organizationId?: number | null) {
    if (!this.validateCardId(schedule.squareCardId)) {
      return;
    }
    
    if (organizationId !== undefined) {
      const allowed = await this.checkLeagueOrgAccess(schedule.leagueId, organizationId, 'addSchedule');
      if (!allowed) return;
    }

    logger.info(`[PaymentScheduler] Adding new payment schedule`, {
      scheduleId: schedule.id,
      amount: schedule.amount,
      nextPaymentDate: schedule.nextPaymentDate,
      frequency: schedule.frequency,
      bowlerId: schedule.bowlerId,
      cardId: `${schedule.squareCardId?.substring(0, 10)}...`,
      addedAt: new Date().toISOString()
    });
    this.schedulePayment(schedule);
  }

  async removeSchedule(scheduleId: number, organizationId?: number | null) {
    logger.info(`[PaymentScheduler] Removing payment schedule ${scheduleId}`, {
      removalTime: new Date().toISOString(),
      organizationId: organizationId ?? 'not specified'
    });
    
    if (organizationId !== undefined) {
      const scheduleRow = await db
        .select({ leagueId: paymentSchedules.leagueId })
        .from(paymentSchedules)
        .where(eq(paymentSchedules.id, scheduleId))
        .limit(1);

      if (scheduleRow.length === 0) {
        logger.info(`[PaymentScheduler] Schedule not found, cannot remove: ${scheduleId}`);
        return;
      }

      const allowed = await this.checkLeagueOrgAccess(scheduleRow[0].leagueId, organizationId, 'removeSchedule');
      if (!allowed) return;
    }
    
    this.cancelJob(`payment-${scheduleId}`);
  }

  async updateSchedule(schedule: PaymentSchedule, organizationId?: number | null) {
    if (!this.validateCardId(schedule.squareCardId)) {
      logger.error(`[PaymentScheduler] Cannot update schedule with invalid card ID`, {
        scheduleId: schedule.id,
        bowlerId: schedule.bowlerId,
        validationTime: new Date().toISOString()
      });
      return;
    }
    
    if (organizationId !== undefined) {
      const allowed = await this.checkLeagueOrgAccess(schedule.leagueId, organizationId, 'updateSchedule');
      if (!allowed) return;
    }

    logger.info(`[PaymentScheduler] Updating payment schedule ${schedule.id}`, {
      amount: schedule.amount,
      nextPaymentDate: schedule.nextPaymentDate,
      frequency: schedule.frequency,
      bowlerId: schedule.bowlerId,
      cardId: `${schedule.squareCardId?.substring(0, 10)}...`,
      updatedAt: new Date().toISOString()
    });
    this.schedulePayment(schedule);
  }
}

export const paymentScheduler = new PaymentScheduler();
