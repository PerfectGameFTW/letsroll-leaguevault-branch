import { startOfToday, isValid } from "date-fns";
import {
  getEffectiveBowlingWeeks,
  countBowlingWeeksPassed,
  toIsoDateStr,
} from "./schedule-utils";

export interface BowlerPastDueLeague {
  seasonStart: string | Date;
  seasonEnd?: string | Date | null;
  weekDay?: string | null;
  weeklyFee: number;
  paymentMode?: string | null;
  totalBowlingWeeks?: number | null;
  skipDates?: string[] | null;
  cancelledDates?: string[] | null;
  doublePayDates?: string[] | null;
}

function getSeasonLengthWeeks(league: {
  seasonStart: string | Date;
  seasonEnd: string | Date;
  totalBowlingWeeks?: number | null;
  cancelledDates?: string[] | null;
}): number {
  if (!league.seasonStart || !league.seasonEnd) return 0;
  if (league.totalBowlingWeeks != null) {
    return getEffectiveBowlingWeeks(
      league.totalBowlingWeeks,
      league.cancelledDates ?? [],
    );
  }
  const start = new Date(league.seasonStart);
  const end = new Date(league.seasonEnd);
  if (!isValid(start) || !isValid(end)) return 0;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / msPerWeek));
}

/**
 * Source-of-truth past-due calculation shared by the client UI and the
 * server-side autopay-setup guard. Mirrors the per-bowler past-due
 * shown in the bowler payment page.
 *
 * **Double-pay redistribution model**: a league with N double-pay
 * dates bills 2× on each of those dates and bills $0 on the LAST N
 * bowling weeks of the season. The season total stays at
 * `weeklyFee × totalWeeks` regardless of how many double-pay dates
 * are configured — double-pay weeks shift money forward in the
 * schedule, they do not add to the season total.
 *
 * Worked example: 32-week league, $30/week, double-pay on weeks 5 & 6:
 *   - weeks 1–4: $30, week 5: $60, week 6: $60, weeks 7–30: $30,
 *     weeks 31–32: $0. Sum = 30 × $30 + 2 × $30 = $960 = 32 × $30.
 */
export function calculateBowlerPastDue(
  league: BowlerPastDueLeague,
  bowlerPaidAmount: number,
): number {
  const doublePayDates = (league.doublePayDates ?? [])
    .map((d) => d.slice(0, 10))
    .filter(Boolean);
  const doublePayCount = doublePayDates.length;

  const totalWeeks = getSeasonLengthWeeks({
    seasonStart: league.seasonStart,
    seasonEnd: league.seasonEnd ?? league.seasonStart,
    totalBowlingWeeks: league.totalBowlingWeeks,
    cancelledDates: league.cancelledDates,
  });
  const fullSeasonAmount = league.weeklyFee * totalWeeks;

  if (league.paymentMode === "upfront") {
    return Math.max(0, fullSeasonAmount - bowlerPaidAmount);
  }

  const today = startOfToday();
  const todayStr = toIsoDateStr(today);
  const pastExtra =
    doublePayDates.filter((d) => d <= todayStr).length * league.weeklyFee;
  // Last N bowling weeks aren't billed (the double-pay redistribution
  // shifted that money forward), so cap chargeable weeks accordingly.
  const billableWeeks = Math.max(0, totalWeeks - doublePayCount);

  if (league.totalBowlingWeeks != null && league.weekDay) {
    const weeksPassedRaw = countBowlingWeeksPassed(
      league.seasonStart,
      league.weekDay,
      league.skipDates ?? [],
      league.cancelledDates ?? [],
    );
    const chargedWeeks = Math.min(weeksPassedRaw, billableWeeks);
    const dueToDate = Math.min(
      league.weeklyFee * chargedWeeks + pastExtra,
      fullSeasonAmount,
    );
    return Math.max(0, dueToDate - bowlerPaidAmount);
  }

  const seasonStart = new Date(league.seasonStart);
  if (!isValid(seasonStart)) return 0;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksPassedRaw = Math.max(
    0,
    Math.round((today.getTime() - seasonStart.getTime()) / msPerWeek),
  );
  const chargedWeeks = Math.min(weeksPassedRaw, billableWeeks);
  const dueToDate = Math.min(
    league.weeklyFee * chargedWeeks + pastExtra,
    fullSeasonAmount,
  );
  return Math.max(0, dueToDate - bowlerPaidAmount);
}
