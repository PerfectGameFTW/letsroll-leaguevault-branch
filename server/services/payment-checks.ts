import { db } from "../db";
import { eq } from "drizzle-orm";
import { leagues, bowlers, type PaymentSchedule } from "@shared/schema";
import { differenceInWeeks } from "date-fns";
import { logger } from "../logger";
import { storage } from "../storage";
import { getEffectiveBowlingWeeks, countBowlingWeeksPassed } from "@shared/schedule-utils";
import {
  executeCharge,
  createPaymentRecord,
  getTotalPaidInSeason,
} from "./payment-execution";
import { getPaymentProvider, ProviderNotConfiguredError } from "./payment-provider-factory";
import type { OrderLineItem } from "./payment-provider";

export async function checkAndChargeFinalTwoWeeks(
  scheduleRecord: PaymentSchedule,
  league: typeof leagues.$inferSelect,
  jobId: string
): Promise<void> {
  try {
    const dueByWeek = league.finalTwoWeeksDueWeek ?? 6;
    const finalTwoWeeksAmount = league.weeklyFee * 2;
    if (finalTwoWeeksAmount <= 0) return;

    const seasonStart = new Date(league.seasonStart);
    const now = new Date();

    let currentWeek: number;
    if (league.totalBowlingWeeks != null && league.weekDay) {
      currentWeek = countBowlingWeeksPassed(
        seasonStart,
        league.weekDay,
        league.skipDates ?? [],
        league.cancelledDates ?? []
      );
    } else {
      currentWeek = Math.max(0, differenceInWeeks(now, seasonStart));
    }

    if (currentWeek < dueByWeek) {
      return;
    }

    const seasonEnd = new Date(league.seasonEnd);
    const totalPaid = await getTotalPaidInSeason(
      scheduleRecord.bowlerId,
      scheduleRecord.leagueId,
      seasonStart,
      seasonEnd
    );

    if (totalPaid >= finalTwoWeeksAmount) {
      logger.info(`[PaymentScheduler] Final 2 weeks already paid for ${jobId}`, {
        totalPaid,
        finalTwoWeeksAmount,
        currentWeek,
        dueByWeek,
      });
      return;
    }

    logger.info(`[PaymentScheduler] Auto-charging final 2 weeks for ${jobId}`, {
      finalTwoWeeksAmount,
      currentWeek,
      dueByWeek,
      bowlerId: scheduleRecord.bowlerId,
      leagueId: scheduleRecord.leagueId,
    });

    const locationId = league?.locationId ?? null;
    let provider;
    try {
      provider = await getPaymentProvider(locationId);
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        logger.warn(`[PaymentScheduler] Provider not configured for final 2 weeks charge ${jobId}, skipping`, { locationId });
        return;
      }
      throw e;
    }

    const bowler = await db.select().from(bowlers).where(eq(bowlers.id, scheduleRecord.bowlerId)).then(r => r[0]);
    const buyerEmail = bowler?.email || undefined;
    const paymentCustomerId = bowler?.paymentCustomerId || undefined;
    if (!paymentCustomerId && provider.validateCardId(scheduleRecord.paymentCardId)) {
      logger.warn(`[PaymentScheduler] Final-two-weeks card-on-file charge for ${jobId} has no customer ID — provider may reject the payment`, {
        bowlerId: scheduleRecord.bowlerId,
      });
    }

    const lineItems: OrderLineItem[] = [];
    if (league.lineageItemVariationId) {
      lineItems.push({ catalogObjectId: league.lineageItemVariationId, quantity: '2' });
    }
    if (league.prizeFundItemVariationId) {
      lineItems.push({ catalogObjectId: league.prizeFundItemVariationId, quantity: '2' });
    }

    const finalPaymentResult = await executeCharge(
      provider,
      scheduleRecord.paymentCardId!,
      finalTwoWeeksAmount,
      lineItems,
      paymentCustomerId,
      buyerEmail
    );

    if (finalPaymentResult.status === 'success') {
      await createPaymentRecord(
        scheduleRecord,
        finalTwoWeeksAmount,
        'paid',
        league,
        finalPaymentResult.paymentId,
        'Auto-charged: Final 2 Weeks',
        new Date().toISOString(),
        undefined,
        finalPaymentResult.providerRef,
        provider.providerName,
      );

      logger.info(`[PaymentScheduler] Final 2 weeks auto-charge successful for ${jobId}`, {
        amount: finalTwoWeeksAmount,
        paymentId: finalPaymentResult.paymentId,
      });
    } else {
      await createPaymentRecord(
        scheduleRecord,
        finalTwoWeeksAmount,
        'failed',
        league,
        undefined,
        `Auto-charge failed: Final 2 Weeks - ${finalPaymentResult.error}`,
        new Date().toISOString(),
        undefined,
        undefined,
        provider.providerName,
      );

      logger.error(`[PaymentScheduler] Final 2 weeks auto-charge failed for ${jobId}`, {
        error: finalPaymentResult.error,
        amount: finalTwoWeeksAmount,
      });
    }
  } catch (error) {
    logger.error(`[PaymentScheduler] Error checking final 2 weeks for ${jobId}`, {
      error: error instanceof Error ? error.message : error,
    });
  }
}

export async function checkPaidInFull(
  scheduleRecord: PaymentSchedule,
  league: typeof leagues.$inferSelect,
  jobId: string,
  cancelJobCallback: (jobId: string) => void
): Promise<boolean> {
  try {
    const seasonStart = new Date(league.seasonStart);
    const seasonEnd = new Date(league.seasonEnd);
    let totalWeeks: number;
    if (league.totalBowlingWeeks != null) {
      totalWeeks = getEffectiveBowlingWeeks(
        league.totalBowlingWeeks,
        league.cancelledDates ?? []
      );
    } else {
      totalWeeks = Math.max(0, differenceInWeeks(seasonEnd, seasonStart));
    }
    const fullSeasonAmount = league.weeklyFee * totalWeeks;

    if (fullSeasonAmount <= 0) return false;

    const totalPaid = await getTotalPaidInSeason(
      scheduleRecord.bowlerId,
      scheduleRecord.leagueId,
      seasonStart,
      seasonEnd
    );

    if (totalPaid >= fullSeasonAmount) {
      logger.info(`[PaymentScheduler] Bowler paid in full, deactivating schedule for ${jobId}`, {
        totalPaid,
        fullSeasonAmount,
        scheduleId: scheduleRecord.id,
        bowlerId: scheduleRecord.bowlerId,
        leagueId: scheduleRecord.leagueId,
      });

      await storage.deactivatePaymentSchedule(scheduleRecord.id, `paid_in_full:scheduled_job=${jobId}`);
      cancelJobCallback(`payment-${scheduleRecord.id}`);
      return true;
    }

    return false;
  } catch (error) {
    logger.error(`[PaymentScheduler] Error checking paid-in-full for ${jobId}`, {
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
}
