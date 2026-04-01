import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { paymentSchedules, payments, leagues, DEFAULT_TIMEZONE, type PaymentSchedule } from "@shared/schema";
import { addWeeks, addMonths, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { logger } from "../logger";
import { getNextLeagueDateTime } from "../utils/league-datetime.js";
import { storage } from "../storage";
import { isDateSkippedOrCancelled } from "@shared/schedule-utils";
import { executeScheduledPayment, computePaymentSplit, type ChargeResult } from "./payment-execution";
import { checkAndChargeFinalTwoWeeks, checkPaidInFull } from "./payment-checks";

interface SchedulerCallbacks {
  schedulePayment: (record: PaymentSchedule) => void;
  cancelJob: (jobId: string) => void;
}

export async function processScheduledPaymentJob(
  scheduleRecord: PaymentSchedule,
  jobId: string,
  callbacks: SchedulerCallbacks
): Promise<void> {
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
      callbacks.schedulePayment({ ...scheduleRecord, nextPaymentDate: nextDate.toISOString() });
      return;
    }

    const paymentResult = await executeScheduledPayment(scheduleRecord, league, jobId);

    if (paymentResult.status === 'success') {
      await handleSuccessfulPayment(scheduleRecord, league, paymentResult, jobId, callbacks);
    } else {
      await handleFailedPayment(scheduleRecord, paymentResult, jobId);
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
}

export function computeNextPaymentDate(
  scheduleRecord: PaymentSchedule,
  league: typeof leagues.$inferSelect
): Date {
  const tz = league?.timezone ?? DEFAULT_TIMEZONE;
  const currentPaymentDate = new Date(scheduleRecord.nextPaymentDate);

  if (scheduleRecord.frequency === 'weekly' && league) {
    return getNextLeagueDateTime(
      currentPaymentDate,
      league.weekDay,
      league.competitionStartTime,
      tz,
      league.skipDates ?? [],
      league.cancelledDates ?? []
    );
  }

  if (scheduleRecord.frequency === 'monthly') {
    let nextDate = addMonths(currentPaymentDate, 1);
    if (league?.competitionStartTime) {
      const [h, m] = league.competitionStartTime.split(':').map(Number);
      nextDate = setHours(setMinutes(setSeconds(setMilliseconds(nextDate, 0), 0), m), h);
      nextDate = fromZonedTime(nextDate, tz);
    }
    return nextDate;
  }

  return addWeeks(currentPaymentDate, 1);
}

async function handleSuccessfulPayment(
  scheduleRecord: PaymentSchedule,
  league: typeof leagues.$inferSelect,
  paymentResult: ChargeResult,
  jobId: string,
  callbacks: SchedulerCallbacks
) {
  const isUpfrontLeague = league?.paymentMode === 'upfront';
  const nextDate = computeNextPaymentDate(scheduleRecord, league);

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
      cardpointeRetref: paymentResult.providerRef?.cardpointeRetref,
      cardpointeAuthcode: paymentResult.providerRef?.cardpointeAuthcode,
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
    callbacks.cancelJob(jobId);
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
      (id) => callbacks.cancelJob(id)
    );
    if (paidInFull) {
      return;
    }
  }

  logger.info(`[PaymentScheduler] Scheduling next payment for ${jobId}`, {
    nextPaymentDate: nextDate,
    schedulingTime: new Date().toISOString()
  });

  callbacks.schedulePayment({
    ...scheduleRecord,
    nextPaymentDate: nextDate.toISOString(),
  });
}

async function handleFailedPayment(
  scheduleRecord: PaymentSchedule,
  paymentResult: ChargeResult,
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
