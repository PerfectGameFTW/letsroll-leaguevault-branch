import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { League, Payment } from '@shared/schema';
import { calculateFinancials } from '@/lib/financial-utils';

function isoDate(year: number, month1: number, day: number): string {
  const m = String(month1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function makeLeague(overrides: Partial<League> = {}): League {
  return {
    id: 1,
    name: 'Test League',
    weeklyFee: 3000,
    seasonStart: isoDate(2025, 9, 3),
    seasonEnd: isoDate(2026, 4, 22),
    weekDay: 'Wednesday',
    totalBowlingWeeks: 32,
    skipDates: [],
    cancelledDates: [],
    paymentMode: 'weekly',
    doublePayDates: [],
    ...overrides,
  } as unknown as League;
}

function paid(amount: number, weekOf: string = isoDate(2025, 9, 3)): Payment {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    bowlerId: 1,
    leagueId: 1,
    amount,
    weekOf,
    status: 'paid',
    type: 'cash',
  } as unknown as Payment;
}

function setToday(year: number, month1: number, day: number): void {
  vi.setSystemTime(new Date(year, month1 - 1, day, 12, 0, 0, 0));
}

describe('calculateFinancials — totalDueToDate is capped at fullSeasonAmount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mid-season with no double-pay weeks: charges weekly only', () => {
    const league = makeLeague();
    setToday(2025, 10, 22);

    const result = calculateFinancials(league, []);

    expect(result.totalWeeksInSeason).toBe(32);
    expect(result.fullSeasonAmount).toBe(96000);
    expect(result.weeksPassed).toBe(8);
    expect(result.doublePay.dates).toEqual([]);
    expect(result.doublePay.totalExtra).toBe(0);
    expect(result.totalDueToDate).toBe(8 * 3000);
    expect(result.amountPastDue).toBe(8 * 3000);
  });

  it('two double-pay dates inflate fullSeasonAmount by 2× weekly fee', () => {
    const league = makeLeague({
      doublePayDates: [isoDate(2026, 4, 15), isoDate(2026, 4, 22)],
    });
    setToday(2025, 10, 22);

    const result = calculateFinancials(league, []);

    expect(result.fullSeasonAmount).toBe(32 * 3000 + 2 * 3000);
    expect(result.doublePay.totalExtra).toBe(6000);
    expect(result.doublePay.perWeekExtra).toBe(3000);
    expect(result.doublePay.pastExtra).toBe(0);
    expect(result.totalDueToDate).toBe(8 * 3000);
  });

  it('past double-pay dates roll into pastExtra and totalDueToDate', () => {
    const league = makeLeague({
      doublePayDates: [isoDate(2025, 10, 1), isoDate(2026, 4, 22)],
    });
    setToday(2025, 10, 22);

    const result = calculateFinancials(league, []);

    expect(result.weeksPassed).toBe(8);
    expect(result.doublePay.pastExtra).toBe(3000);
    expect(result.totalDueToDate).toBe(8 * 3000 + 3000);
    expect(result.amountPastDue).toBe(8 * 3000 + 3000);
    expect(result.totalDueToDate).toBeLessThanOrEqual(result.fullSeasonAmount);
  });

  it('season fully completed with full payment: zero past due', () => {
    const league = makeLeague();
    setToday(2026, 4, 23);

    const payments = [paid(96000)];
    const result = calculateFinancials(league, payments);

    expect(result.weeksPassed).toBe(32);
    expect(result.fullSeasonAmount).toBe(96000);
    expect(result.totalDueToDate).toBe(96000);
    expect(result.totalPaid).toBe(96000);
    expect(result.amountPastDue).toBe(0);
    expect(result.remainingBalance).toBe(0);
    expect(result.doublePay.isPaid).toBe(true);
  });

  it('season fully completed with partial payment: past due equals unpaid portion of full season', () => {
    const league = makeLeague();
    setToday(2026, 4, 23);

    const payments = [paid(60000)];
    const result = calculateFinancials(league, payments);

    expect(result.totalDueToDate).toBe(96000);
    expect(result.amountPastDue).toBe(36000);
    expect(result.amountPastDue).toBeLessThanOrEqual(result.fullSeasonAmount);
  });

  it('past season end: totalDueToDate never exceeds fullSeasonAmount even weeks later', () => {
    const league = makeLeague();
    setToday(2026, 6, 1);

    const result = calculateFinancials(league, []);

    expect(result.totalDueToDate).toBe(96000);
    expect(result.totalDueToDate).toBeLessThanOrEqual(result.fullSeasonAmount);
  });
});
