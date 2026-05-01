import { startOfToday, isValid } from "date-fns";
import type { League, Payment } from "@shared/schema";
import {
  getEffectiveBowlingWeeks,
  countBowlingWeeksPassed,
  toIsoDateStr,
} from "@shared/schedule-utils";

/**
 * Task #646 — replaces the old `FinalTwoWeeksStatus` shape. The
 * admin now picks 0–2 individual ISO dates ("double-pay weeks") and
 * each one bills the bowler 2× the weekly fee on that date.
 */
export interface DoublePayStatus {
  /** ISO yyyy-mm-dd dates flagged as 2× pay weeks (0–2 entries). */
  dates: string[];
  /** Per-week extra owed (= weeklyFee). */
  perWeekExtra: number;
  /** Total extra owed across the whole season (= dates.length * weeklyFee). */
  totalExtra: number;
  /** Extra already due as of today (= weeklyFee × dates already on/before today). */
  pastExtra: number;
  /**
   * True when the cumulative paid amount covers the full season
   * (regular + all double-pay extras). Surfaced for parity with the
   * old `finalTwoWeeks.isPaid` flag.
   */
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

  const fullSeasonAmount = league.weeklyFee * totalWeeksInSeason + totalExtra;
  const remainingBalance = Math.max(0, fullSeasonAmount - totalPaid);

  const isUpfront = league.paymentMode === 'upfront';

  if (isUpfront) {
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

  const totalDueToDateRaw = league.weeklyFee * weeksPassed + pastExtra;
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

export function calculateBowlerPastDue(
  league: {
    seasonStart: string | Date;
    seasonEnd?: string | Date;
    weekDay?: string;
    weeklyFee: number;
    paymentMode?: string;
    totalBowlingWeeks?: number | null;
    skipDates?: string[] | null;
    cancelledDates?: string[] | null;
    doublePayDates?: string[] | null;
  },
  bowlerPaidAmount: number
): number {
  const doublePayDates = (league.doublePayDates ?? [])
    .map(d => d.slice(0, 10))
    .filter(Boolean);

  if (league.paymentMode === 'upfront') {
    const totalWeeks = getSeasonLengthWeeks({
      seasonStart: league.seasonStart,
      seasonEnd: league.seasonEnd ?? league.seasonStart,
      weekDay: league.weekDay,
      totalBowlingWeeks: league.totalBowlingWeeks,
      skipDates: league.skipDates,
      cancelledDates: league.cancelledDates,
    });
    const fullSeasonAmount = league.weeklyFee * totalWeeks
      + doublePayDates.length * league.weeklyFee;
    return Math.max(0, fullSeasonAmount - bowlerPaidAmount);
  }

  const today = startOfToday();
  const todayStr = toIsoDateStr(today);
  const pastExtra = doublePayDates.filter(d => d <= todayStr).length * league.weeklyFee;

  if (league.totalBowlingWeeks != null && league.weekDay) {
    const weeksPassed = countBowlingWeeksPassed(
      league.seasonStart,
      league.weekDay,
      league.skipDates ?? [],
      league.cancelledDates ?? []
    );
    const dueToDate = league.weeklyFee * weeksPassed + pastExtra;
    return Math.max(0, dueToDate - bowlerPaidAmount);
  }

  const seasonStart = new Date(league.seasonStart);
  if (!isValid(seasonStart)) return 0;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksPassed = Math.max(0, Math.round(
    (today.getTime() - seasonStart.getTime()) / msPerWeek
  ));
  const dueToDate = league.weeklyFee * weeksPassed + pastExtra;
  return Math.max(0, dueToDate - bowlerPaidAmount);
}

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
    const today = startOfToday();
    const todayStr = toIsoDateStr(today);
    const pastExtra = doublePayDates.filter(d => d <= todayStr).length * league.weeklyFee;
    const totalExtra = doublePayDates.length * league.weeklyFee;
    totalSeasonDues = league.weeklyFee * weeksDue + pastExtra;
    fullSeasonAmount = league.weeklyFee * totalWeeksInSeason + totalExtra;
    amountPastDue = Math.max(0, totalSeasonDues - totalPaidAmount);
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
