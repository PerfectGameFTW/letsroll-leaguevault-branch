import { startOfToday, isValid } from "date-fns";
import type { League, Payment } from "@shared/schema";
import {
  getEffectiveBowlingWeeks,
  countBowlingWeeksPassed,
  toIsoDateStr,
} from "@shared/schedule-utils";

/**
 * Task #646 — replaces the old `FinalTwoWeeksStatus` shape. The
 * admin picks 0–2 individual ISO dates ("double-pay weeks") that
 * bill 2× the weekly fee on those dates.
 *
 * **Redistribution model**: double-pay weeks shift money forward in
 * the season — they do NOT add to the season total. A 32-week league
 * with 2 double-pay weeks still totals `weeklyFee × 32`; the last 2
 * regular bowling weeks are not billed (their dollars were collected
 * earlier on the doubled weeks).
 */
export interface DoublePayStatus {
  /** ISO yyyy-mm-dd dates flagged as 2× pay weeks (0–2 entries). */
  dates: string[];
  /** Extra owed on each double-pay date above the regular weekly fee (= weeklyFee). */
  perWeekExtra: number;
  /**
   * Sum of the per-double-pay-date extras (= dates.length × weeklyFee).
   * NOTE: this does NOT add to `fullSeasonAmount` — it represents the
   * dollars that have been shifted forward from the last N regular
   * bowling weeks.
   */
  totalExtra: number;
  /** Extras already due as of today (= weeklyFee × dates already on/before today). */
  pastExtra: number;
  /** True when the cumulative paid amount covers the full season. */
  isPaid: boolean;
}

export interface FinancialCalculation {
  weeksPassed: number;
  totalWeeksInSeason: number;
  totalDueToDate: number;
  totalPaid: number;
  amountPastDue: number;
  fullSeasonAmount: number;
  remainingBalance: number;
  doublePay: DoublePayStatus;
}

type LeagueWithSchedule = {
  seasonStart: string | Date;
  seasonEnd: string | Date;
  weekDay?: string;
  totalBowlingWeeks?: number | null;
  skipDates?: string[] | null;
  cancelledDates?: string[] | null;
};

export function getSeasonLengthWeeks(league: LeagueWithSchedule | null | undefined): number {
  if (!league?.seasonStart || !league?.seasonEnd) return 0;
  if (league.totalBowlingWeeks != null) {
    return getEffectiveBowlingWeeks(
      league.totalBowlingWeeks,
      league.cancelledDates ?? []
    );
  }
  const start = new Date(league.seasonStart);
  const end = new Date(league.seasonEnd);
  if (!isValid(start) || !isValid(end)) return 0;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / msPerWeek));
}

export function getWeeksPassedInSeason(league: LeagueWithSchedule | null | undefined): number {
  if (!league?.seasonStart || !league?.seasonEnd) return 0;
  const maxWeeks = getSeasonLengthWeeks(league);
  if (league.totalBowlingWeeks != null && league.weekDay) {
    const passed = countBowlingWeeksPassed(
      league.seasonStart,
      league.weekDay,
      league.skipDates ?? [],
      league.cancelledDates ?? []
    );
    return Math.min(passed, maxWeeks);
  }
  const seasonStart = new Date(league.seasonStart);
  const seasonEnd = new Date(league.seasonEnd);
  if (!isValid(seasonStart) || !isValid(seasonEnd)) return 0;
  const today = startOfToday();
  const effectiveDate = today < seasonStart ? seasonStart : today > seasonEnd ? seasonEnd : today;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((effectiveDate.getTime() - seasonStart.getTime()) / msPerWeek));
}

export function getTotalPaidAmount(payments: Payment[]): number {
  return payments
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + p.amount, 0);
}

function emptyDoublePay(weeklyFee = 0): DoublePayStatus {
  return {
    dates: [],
    perWeekExtra: weeklyFee,
    totalExtra: 0,
    pastExtra: 0,
    isPaid: false,
  };
}

export function calculateFinancials(league: League | null | undefined, payments: Payment[]): FinancialCalculation {
  const totalPaid = getTotalPaidAmount(payments);

  if (!league?.seasonStart || !league?.seasonEnd || !league?.weeklyFee) {
    return {
      weeksPassed: 0,
      totalWeeksInSeason: 0,
      totalDueToDate: 0,
      totalPaid,
      amountPastDue: 0,
      fullSeasonAmount: 0,
      remainingBalance: 0,
      doublePay: emptyDoublePay(),
    };
  }

  const weeksPassed = getWeeksPassedInSeason(league);
  const totalWeeksInSeason = getSeasonLengthWeeks(league);

  const doublePayDates = (league.doublePayDates ?? [])
    .map(d => d.slice(0, 10))
    .filter(Boolean);
  const perWeekExtra = league.weeklyFee;
  const totalExtra = doublePayDates.length * perWeekExtra;

  // Redistribution model: fullSeasonAmount stays at weeklyFee × totalWeeks
  // regardless of double-pay count. The doubled charges shift dollars from
  // the last N regular weeks forward to the double-pay dates; they do not
  // add to the season total.
  const fullSeasonAmount = league.weeklyFee * totalWeeksInSeason;
  const remainingBalance = Math.max(0, fullSeasonAmount - totalPaid);

  const isUpfront = league.paymentMode === 'upfront';

  if (isUpfront) {
    // Upfront leagues: the full season is due immediately and the
    // unpaid remainder is past-due. This matches calculateBowlerView-
    // Financials and the shared calculateBowlerPastDue helper exactly
    // (Task #726 parity). A pre-season "not yet past-due" gate would
    // need to land in all three helpers together — adding it here
    // alone would silently desync the bowler page from the past-due
    // report and the autopay-setup guard.
    const amountPastDue = Math.max(0, fullSeasonAmount - totalPaid);
    return {
      weeksPassed,
      totalWeeksInSeason,
      totalDueToDate: fullSeasonAmount,
      totalPaid,
      amountPastDue,
      fullSeasonAmount,
      remainingBalance,
      doublePay: {
        dates: doublePayDates,
        perWeekExtra,
        totalExtra,
        pastExtra: totalExtra,
        isPaid: totalPaid >= fullSeasonAmount,
      },
    };
  }

  const today = startOfToday();
  const todayStr = toIsoDateStr(today);
  const pastDoublePayCount = doublePayDates.filter(d => d <= todayStr).length;
  const pastExtra = pastDoublePayCount * perWeekExtra;

  // Last N bowling weeks aren't billed (their money was collected earlier
  // on the double-pay dates), so cap chargeable weeks at totalWeeks - N.
  const billableWeeks = Math.max(0, totalWeeksInSeason - doublePayDates.length);
  const chargedWeeks = Math.min(weeksPassed, billableWeeks);
  const totalDueToDateRaw = league.weeklyFee * chargedWeeks + pastExtra;
  const totalDueToDate = Math.min(totalDueToDateRaw, fullSeasonAmount);
  const amountPastDue = Math.max(0, totalDueToDate - totalPaid);

  return {
    weeksPassed,
    totalWeeksInSeason,
    totalDueToDate,
    totalPaid,
    amountPastDue,
    fullSeasonAmount,
    remainingBalance,
    doublePay: {
      dates: doublePayDates,
      perWeekExtra,
      totalExtra,
      pastExtra,
      isPaid: totalPaid >= fullSeasonAmount,
    },
  };
}

export { calculateBowlerPastDue } from "@shared/financial-utils";

export function getPaymentSummary(payments: Payment[]) {
  const paidPayments = payments.filter((p) => p.status === "paid");
  const unpaidPayments = payments.filter((p) => p.status !== "paid");
  return {
    paidPayments,
    totalPaidAmount: paidPayments.reduce((sum, p) => sum + p.amount, 0),
    unpaidPayments,
    totalUnpaidAmount: unpaidPayments.reduce((sum, p) => sum + p.amount, 0),
  };
}
export interface BowlerViewFinancials {
  weeksDue: number;
  totalSeasonDues: number;
  totalWeeksInSeason: number;
  fullSeasonAmount: number;
  amountPastDue: number;
  remainingBalance: number;
  totalPaidAmount: number;
  totalUnpaidAmount: number;
}

export function calculateBowlerViewFinancials(
  league: League | null | undefined,
  payments: Payment[]
): BowlerViewFinancials {
  const { totalPaidAmount, totalUnpaidAmount } = getPaymentSummary(payments);

  let weeksDue = 0;
  let totalSeasonDues = 0;
  let totalWeeksInSeason = 0;
  let fullSeasonAmount = 0;
  let amountPastDue = 0;

  if (league?.seasonStart && league.seasonEnd && league.weeklyFee) {
    weeksDue = getWeeksPassedInSeason(league);
    totalWeeksInSeason = getSeasonLengthWeeks(league);
    const doublePayDates = (league.doublePayDates ?? [])
      .map(d => d.slice(0, 10))
      .filter(Boolean);
    // Redistribution model — see calculateFinancials for full notes.
    fullSeasonAmount = league.weeklyFee * totalWeeksInSeason;

    if (league.paymentMode === "upfront") {
      // Upfront leagues: full season is due immediately. "Amount due to date"
      // is the entire season amount and "past due" is the unpaid remainder.
      // Mirrors calculateFinancials + the shared calculateBowlerPastDue
      // helper exactly (neither gates on season-start; pre-season gating
      // would need to land in all three helpers together).
      totalSeasonDues = fullSeasonAmount;
      amountPastDue = Math.max(0, fullSeasonAmount - totalPaidAmount);
    } else {
      const today = startOfToday();
      const todayStr = toIsoDateStr(today);
      const pastExtra = doublePayDates.filter(d => d <= todayStr).length * league.weeklyFee;
      const billableWeeks = Math.max(0, totalWeeksInSeason - doublePayDates.length);
      const chargedWeeks = Math.min(weeksDue, billableWeeks);
      totalSeasonDues = Math.min(
        league.weeklyFee * chargedWeeks + pastExtra,
        fullSeasonAmount,
      );
      amountPastDue = Math.max(0, totalSeasonDues - totalPaidAmount);
    }
  }

  const remainingBalance = fullSeasonAmount - totalPaidAmount;

  return {
    weeksDue,
    totalSeasonDues,
    totalWeeksInSeason,
    fullSeasonAmount,
    amountPastDue,
    remainingBalance,
    totalPaidAmount,
    totalUnpaidAmount,
  };
}
