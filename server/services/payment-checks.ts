import { leagues, type PaymentSchedule } from "@shared/schema";
import { differenceInWeeks } from "date-fns";
import { logger } from "../logger";
import { storage } from "../storage";
import { getEffectiveBowlingWeeks } from "@shared/schedule-utils";
import { getTotalPaidInSeason } from "./payment-execution";

// Task #646: the legacy `checkAndChargeFinalTwoWeeks` lump-charge
// helper was deleted along with the "Final 2 Weeks Due By" feature.
// New behavior: the autopay scheduler doubles the regular weekly
// charge on each league `doublePayDates` entry (see
// `payment-execution.ts::executeScheduledPayment`). The legacy
// `final_two_weeks_due_week` column is preserved on the leagues
// table only as a one-shot startup-backfill source for
// `doublePayDates`; it is never read by the payment pipeline.

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
    // Task #646: include the per-date double-pay extras
    // (weeklyFee per dated double-pay week) in the full-season target
    // so a schedule with double-pay weeks isn't deactivated before the
    // doubled charges have run.
    const doublePayExtras =
      (league.doublePayDates?.length ?? 0) * league.weeklyFee;
    const fullSeasonAmount = league.weeklyFee * totalWeeks + doublePayExtras;

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
