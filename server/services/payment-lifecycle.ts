import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { paymentSchedules, payments, leagues, DEFAULT_TIMEZONE, type PaymentSchedule } from "@shared/schema";
import { providerNameToPaymentType } from "@shared/schema/constants";
import { addWeeks, addMonths, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { logger } from "../logger";
import { getNextLeagueDateTime } from "../utils/league-datetime.js";
import { storage } from "../storage";
import { isDateSkippedOrCancelled } from "@shared/schedule-utils";
import { executeScheduledPayment, executeChargeForLocation, buildLineItems, computePaymentSplit, fetchBowlerPaymentInfo, type ChargeResult } from "./payment-execution";
import { checkPaidInFull } from "./payment-checks";
import { getUserByBowlerId } from "../storage/users";

/**
 * payer-user attribution is best-effort. If the lookup
 * throws (e.g. transient DB hiccup, or a unit-test mock that doesn't
 * stub the chained `.limit(1)`), we must not fail the autopay write
 * — the row is far more important than its attribution column. Log
 * and fall back to `null`.
 */
async function safeResolvePaidByUserId(bowlerId: number): Promise<number | null> {
  try {
    const u = await getUserByBowlerId(bowlerId);
    return u?.id ?? null;
  } catch (err) {
    logger.warn(`[PaymentLifecycle] paidByUserId lookup failed for bowler ${bowlerId}: ${(err as Error).message}`);
    return null;
  }
}
import { arePartners } from "../storage/bowler-payment-links";
import { bowlers } from "@shared/schema";

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
      cardToken: `${scheduleRecord.paymentCardId?.substring(0, 10)}...`,
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
        cardToken: `${scheduleRecord.paymentCardId?.substring(0, 10)}...`
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

    // Task #646: prefer the actual charged amount (which may be 2× the
    // schedule's stored weekly amount on a double-pay week) so the
    // persisted payment row matches what the provider actually billed.
    const billedAmount = paymentResult.chargedAmount ?? scheduleRecord.amount;
    const { lineageAmount, prizeFundAmount } = computePaymentSplit(billedAmount, league);
    // Task #646: stamp a clear marker on double-pay charges so admins
    // viewing the payment history can tell at a glance why the row is
    // 2× the usual weekly amount.
    const notes = paymentResult.isDoublePay
      ? 'Double-pay week (2× weekly fee)'
      : undefined;
    // derive payer user once. The schedule's bowlerId is
    // the payer; combined-autopay rows for additional bowlers carry
    // the same paidByUserId.
    const paidByUserId = await safeResolvePaidByUserId(scheduleRecord.bowlerId);

    await tx.insert(payments).values({
      bowlerId: scheduleRecord.bowlerId,
      leagueId: scheduleRecord.leagueId,
      amount: billedAmount,
      lineageAmount,
      prizeFundAmount,
      status: 'paid',
      type: providerNameToPaymentType(paymentResult.providerName || ''),
      weekOf: scheduleRecord.nextPaymentDate,
      providerPaymentId: paymentResult.paymentId,
      cloverChargeId: paymentResult.providerRef?.cloverChargeId,
      // same receipt fields the one-off charge path
      // persists. `buyerEmailMissing` is meaningful for Square only —
      // Clover never emits a hosted receipt regardless.
      receiptUrl: paymentResult.receiptUrl,
      receiptNumber: paymentResult.receiptNumber,
      receiptEmailMissing:
        paymentResult.providerName === 'square'
          ? paymentResult.buyerEmailMissing ?? false
          : false,
      notes,
      paidByUserId,
    });

    logger.info(`[PaymentScheduler] Transaction completed for ${jobId}`, {
      completionTime: new Date().toISOString(),
      nextScheduledDate: nextDate
    });
  });

  // combined autopay — charge each linked partner on the
  // SAME card (the payer's vault) and stamp the payer as paidByUserId.
  // Each partner is re-validated as an accepted link at firing time
  // so a since-removed link is not silently honored.
  const additional = scheduleRecord.additionalBowlerIds ?? [];
  if (additional.length > 0) {
    const paidByUserId = await safeResolvePaidByUserId(scheduleRecord.bowlerId);
    const orgId = league?.organizationId ?? null;
    for (const partnerBowlerId of additional) {
      try {
        if (!orgId) {
          logger.warn(`[PaymentScheduler] Skipping combined-autopay partner ${partnerBowlerId} for ${jobId} — league has no org`);
          continue;
        }
        const stillPartners = await arePartners(scheduleRecord.bowlerId, partnerBowlerId, orgId);
        if (!stillPartners) {
          logger.warn(`[PaymentScheduler] Skipping combined-autopay partner ${partnerBowlerId} for ${jobId} — link no longer accepted`);
          continue;
        }
        const partnerBowlerRow = await db.select().from(bowlers).where(eq(bowlers.id, partnerBowlerId)).then(r => r[0]);
        if (!partnerBowlerRow || partnerBowlerRow.organizationId !== orgId) {
          logger.warn(`[PaymentScheduler] Skipping combined-autopay partner ${partnerBowlerId} for ${jobId} — bowler missing or cross-org`);
          continue;
        }
        if (!scheduleRecord.paymentCardId) {
          logger.warn(`[PaymentScheduler] Skipping combined-autopay partner ${partnerBowlerId} for ${jobId} — schedule has no card`);
          continue;
        }
        const partnerLineItems = buildLineItems(league, '1');
        // Reuse payer's vaulted customer id via the same helper used by
        // the primary autopay path so Square/Clover customer-id
        // resolution stays consistent across all charge entry points.
        const { paymentCustomerId: payerCustomerId } = await fetchBowlerPaymentInfo(scheduleRecord.bowlerId);
        const partnerCharge = await executeChargeForLocation(
          scheduleRecord.paymentCardId,
          scheduleRecord.amount,
          partnerLineItems,
          league?.locationId ?? null,
          payerCustomerId,
          partnerBowlerRow.email ?? undefined,
        );
        const { lineageAmount: pLineage, prizeFundAmount: pPrize } = computePaymentSplit(scheduleRecord.amount, league);
        if (partnerCharge.status === 'success') {
          await db.insert(payments).values({
            bowlerId: partnerBowlerId,
            leagueId: scheduleRecord.leagueId,
            amount: scheduleRecord.amount,
            lineageAmount: pLineage,
            prizeFundAmount: pPrize,
            status: 'paid',
            type: providerNameToPaymentType(partnerCharge.providerName || ''),
            weekOf: scheduleRecord.nextPaymentDate,
            providerPaymentId: partnerCharge.paymentId,
            cloverChargeId: partnerCharge.providerRef?.cloverChargeId,
            receiptUrl: partnerCharge.receiptUrl,
            receiptNumber: partnerCharge.receiptNumber,
            receiptEmailMissing:
              partnerCharge.providerName === 'square'
                ? partnerCharge.buyerEmailMissing ?? false
                : false,
            notes: 'Combined autopay (paid by partner)',
            paidByUserId,
          });
        } else {
          await db.insert(payments).values({
            bowlerId: partnerBowlerId,
            leagueId: scheduleRecord.leagueId,
            amount: scheduleRecord.amount,
            status: 'failed',
            type: providerNameToPaymentType(partnerCharge.providerName || ''),
            weekOf: scheduleRecord.nextPaymentDate,
            notes: `Combined autopay failed: ${partnerCharge.error}`,
            paidByUserId,
          });
        }
      } catch (err) {
        logger.error(`[PaymentScheduler] Combined-autopay partner ${partnerBowlerId} for ${jobId} threw`, {
          error: err instanceof Error ? { name: err.name, message: err.message } : err,
        });
      }
    }
  }

  if (isUpfrontLeague) {
    logger.info(`[PaymentScheduler] Upfront league — deactivating schedule after payment for ${jobId}`, {
      scheduleId: scheduleRecord.id,
      bowlerId: scheduleRecord.bowlerId,
      leagueId: scheduleRecord.leagueId,
    });
    await storage.deactivatePaymentSchedule(scheduleRecord.id, `paid_in_full:scheduled_job=${jobId}`);
    callbacks.cancelJob(jobId);
    return;
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
      cardToken: `${scheduleRecord.paymentCardId?.substring(0, 10)}...`
    },
    failureTime: new Date().toISOString()
  });

  const paidByUserId = await safeResolvePaidByUserId(scheduleRecord.bowlerId);
  await db.insert(payments).values({
    bowlerId: scheduleRecord.bowlerId,
    leagueId: scheduleRecord.leagueId,
    amount: scheduleRecord.amount,
    status: 'failed',
    type: providerNameToPaymentType(paymentResult.providerName || ''),
    weekOf: scheduleRecord.nextPaymentDate,
    notes: `Failed payment: ${paymentResult.error}`,
    paidByUserId,
  });
}
