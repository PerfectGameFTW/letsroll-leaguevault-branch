import { addWeeks, startOfToday } from "date-fns";
import type { League, Payment } from "@shared/schema";
import {
  getEffectiveBowlingWeeks,
  countBowlingWeeksPassed,
  getBowlingDateByWeekNumber,
} from "@shared/schedule-utils";

export interface FinalTwoWeeksStatus {
  amount: number;
  dueByWeek: number;
  dueByDate: Date | null;
  isPaid: boolean;
  isPastDue: boolean;
}

export interface FinancialCalculation {
  weeksPassed: number;
  totalWeeksInSeason: number;
  totalDueToDate: number;
  totalPaid: number;
  amountPastDue: number;
  fullSeasonAmount: number;
  remainingBalance: number;
  finalTwoWeeks: FinalTwoWeeksStatus;
  finalTwoWeeksDue: boolean;
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
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / msPerWeek));
}

export function getWeeksPassedInSeason(league: LeagueWithSchedule | null | undefined): number {
  if (!league?.seasonStart || !league?.seasonEnd) return 0;
  if (league.totalBowlingWeeks != null && league.weekDay) {
    return countBowlingWeeksPassed(
      league.seasonStart,
      league.weekDay,
      league.skipDates ?? [],
      league.cancelledDates ?? []
    );
  }
  const seasonStart = new Date(league.seasonStart);
  const seasonEnd = new Date(league.seasonEnd);
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

export function calculateFinancials(league: League | null | undefined, payments: Payment[]): FinancialCalculation {
  const totalPaid = getTotalPaidAmount(payments);

  const defaultFinalTwoWeeks: FinalTwoWeeksStatus = {
    amount: 0,
    dueByWeek: 6,
    dueByDate: null,
    isPaid: false,
    isPastDue: false,
  };

  if (!league?.seasonStart || !league?.seasonEnd || !league?.weeklyFee) {
    return {
      weeksPassed: 0,
      totalWeeksInSeason: 0,
      totalDueToDate: 0,
      totalPaid,
      amountPastDue: 0,
      fullSeasonAmount: 0,
      remainingBalance: 0,
      finalTwoWeeks: defaultFinalTwoWeeks,
      finalTwoWeeksDue: false,
    };
  }

  const weeksPassed = getWeeksPassedInSeason(league);
  const totalWeeksInSeason = getSeasonLengthWeeks(league);
  const fullSeasonAmount = league.weeklyFee * totalWeeksInSeason;
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
      finalTwoWeeks: { ...defaultFinalTwoWeeks, isPaid: true },
      finalTwoWeeksDue: false,
    };
  }

  const dueByWeek = league.finalTwoWeeksDueWeek ?? 6;
  const finalTwoWeeksAmount = league.weeklyFee * 2;
  const today = startOfToday();

  let dueByDate: Date;
  if (league.totalBowlingWeeks != null && league.weekDay) {
    const bowlingDueDate = getBowlingDateByWeekNumber(
      league.seasonStart,
      league.weekDay,
      dueByWeek,
      league.skipDates ?? [],
      league.cancelledDates ?? []
    );
    dueByDate = bowlingDueDate ?? addWeeks(new Date(league.seasonStart), dueByWeek);
  } else {
    dueByDate = addWeeks(new Date(league.seasonStart), dueByWeek);
  }

  const isPastDueDate = today >= dueByDate;
  const isPaid = totalPaid >= finalTwoWeeksAmount;

  const finalTwoWeeks: FinalTwoWeeksStatus = {
    amount: finalTwoWeeksAmount,
    dueByWeek: dueByWeek,
    dueByDate,
    isPaid,
    isPastDue: !isPaid && isPastDueDate,
  };

  let totalDueToDate = league.weeklyFee * weeksPassed;
  if (isPastDueDate) {
    totalDueToDate += finalTwoWeeksAmount;
  }
  const amountPastDue = Math.max(0, totalDueToDate - totalPaid);

  return {
    weeksPassed,
    totalWeeksInSeason,
    totalDueToDate,
    totalPaid,
    amountPastDue,
    fullSeasonAmount,
    remainingBalance,
    finalTwoWeeks,
    finalTwoWeeksDue: isPastDueDate,
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
  },
  bowlerPaidAmount: number
): number {
  if (league.paymentMode === 'upfront') {
    const totalWeeks = getSeasonLengthWeeks({
      seasonStart: league.seasonStart,
      seasonEnd: league.seasonEnd ?? league.seasonStart,
      weekDay: league.weekDay,
      totalBowlingWeeks: league.totalBowlingWeeks,
      skipDates: league.skipDates,
      cancelledDates: league.cancelledDates,
    });
    const fullSeasonAmount = league.weeklyFee * totalWeeks;
    return Math.max(0, fullSeasonAmount - bowlerPaidAmount);
  }

  if (league.totalBowlingWeeks != null && league.weekDay) {
    const weeksPassed = countBowlingWeeksPassed(
      league.seasonStart,
      league.weekDay,
      league.skipDates ?? [],
      league.cancelledDates ?? []
    );
    const dueToDate = league.weeklyFee * weeksPassed;
    return Math.max(0, dueToDate - bowlerPaidAmount);
  }

  const today = startOfToday();
  const seasonStart = new Date(league.seasonStart);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksPassed = Math.max(0, Math.floor(
    (today.getTime() - seasonStart.getTime()) / msPerWeek
  ));
  const dueToDate = league.weeklyFee * weeksPassed;
  return Math.max(0, dueToDate - bowlerPaidAmount);
}
