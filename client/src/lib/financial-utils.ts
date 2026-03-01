import { differenceInWeeks, startOfToday } from "date-fns";
import type { League, Payment } from "@shared/schema";

export interface FinancialCalculation {
  weeksPassed: number;
  totalWeeksInSeason: number;
  totalDueToDate: number;
  totalPaid: number;
  amountPastDue: number;
  fullSeasonAmount: number;
  remainingBalance: number;
}

export function getSeasonLengthWeeks(league: { seasonStart: string | Date; seasonEnd: string | Date } | null | undefined): number {
  if (!league?.seasonStart || !league?.seasonEnd) return 0;
  const start = new Date(league.seasonStart);
  const end = new Date(league.seasonEnd);
  return Math.max(0, differenceInWeeks(end, start));
}

export function getWeeksPassedInSeason(league: { seasonStart: string | Date; seasonEnd: string | Date } | null | undefined): number {
  if (!league?.seasonStart || !league?.seasonEnd) return 0;
  const seasonStart = new Date(league.seasonStart);
  const seasonEnd = new Date(league.seasonEnd);
  const today = startOfToday();

  const effectiveDate = today < seasonStart ? seasonStart : today > seasonEnd ? seasonEnd : today;
  return Math.max(0, differenceInWeeks(effectiveDate, seasonStart));
}

export function getTotalPaidAmount(payments: Payment[]): number {
  return payments
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + p.amount, 0);
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
    };
  }

  const weeksPassed = getWeeksPassedInSeason(league);
  const totalWeeksInSeason = getSeasonLengthWeeks(league);
  const totalDueToDate = league.weeklyFee * weeksPassed;
  const fullSeasonAmount = league.weeklyFee * totalWeeksInSeason;
  const amountPastDue = Math.max(0, totalDueToDate - totalPaid);
  const remainingBalance = Math.max(0, fullSeasonAmount - totalPaid);

  return {
    weeksPassed,
    totalWeeksInSeason,
    totalDueToDate,
    totalPaid,
    amountPastDue,
    fullSeasonAmount,
    remainingBalance,
  };
}

export function calculateBowlerPastDue(
  league: { seasonStart: string | Date; weeklyFee: number },
  bowlerPaidAmount: number
): number {
  const today = startOfToday();
  const seasonStart = new Date(league.seasonStart);
  const weeksPassed = Math.max(0, Math.floor(
    (today.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
  ));
  const dueToDate = league.weeklyFee * weeksPassed;
  return Math.max(0, dueToDate - bowlerPaidAmount);
}
