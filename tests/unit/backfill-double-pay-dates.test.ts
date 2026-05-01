/**
 * Regression test for the Task #646 double-pay backfill.
 *
 * Pins the "truly one-time per league" guarantee: when the
 * backfill successfully seeds `doublePayDates` for a legacy
 * league, it MUST also null out `final_two_weeks_due_week` in
 * the same UPDATE. Without that nulling, an admin who later
 * clears `doublePayDates` to [] (legitimate "0 double-pay weeks"
 * choice) would have those 2 dates silently re-derived on the
 * next server start because the WHERE clause
 *   `final_two_weeks_due_week IS NOT NULL AND
 *    coalesce(array_length(double_pay_dates, 1), 0) = 0`
 * would re-match the row. That regression would reintroduce
 * unintended 2× weekly charges for affected leagues.
 */
import { describe, expect, it, vi } from 'vitest';

interface UpdateCall {
  setArg: Record<string, unknown>;
  whereArg: unknown;
}

const updateCalls: UpdateCall[] = [];
let candidates: Array<Record<string, unknown>> = [];

vi.mock('../../server/db', () => ({
  db: {
    select() {
      return {
        from() {
          return {
            where() {
              return Promise.resolve(candidates);
            },
          };
        },
      };
    },
    update() {
      return {
        set(setArg: Record<string, unknown>) {
          const call: UpdateCall = { setArg, whereArg: undefined };
          updateCalls.push(call);
          return {
            where(whereArg: unknown) {
              call.whereArg = whereArg;
              return Promise.resolve();
            },
          };
        },
      };
    },
  },
}));

vi.mock('../../server/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

const { backfillDoublePayDates } = await import(
  '../../server/migrations/backfill-double-pay-dates'
);

describe('backfillDoublePayDates — re-seed guard', () => {
  it('nulls finalTwoWeeksDueWeek in the same UPDATE that sets doublePayDates', async () => {
    updateCalls.length = 0;
    candidates = [
      {
        id: 1234,
        // Wednesday-start season; weekDay=3 (Wednesday)
        seasonStart: '2024-09-04',
        weekDay: 3,
        finalTwoWeeksDueWeek: 6,
        skipDates: [],
        cancelledDates: [],
      },
    ];

    await backfillDoublePayDates();

    // Exactly one row should have been updated.
    expect(updateCalls).toHaveLength(1);
    const setArg = updateCalls[0].setArg;

    // The seed must include 2 derived ISO dates.
    expect(Array.isArray(setArg.doublePayDates)).toBe(true);
    expect((setArg.doublePayDates as string[]).length).toBe(2);
    for (const d of setArg.doublePayDates as string[]) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    // Critical: legacy column MUST be nulled in the same UPDATE so
    // the WHERE clause never matches this row again on subsequent
    // server starts. Without this, clearing doublePayDates to []
    // would silently re-seed and reintroduce 2× charges.
    expect(setArg.finalTwoWeeksDueWeek).toBeNull();
  });

  it('is a no-op (no UPDATEs) when no candidates remain', async () => {
    updateCalls.length = 0;
    candidates = [];

    await backfillDoublePayDates();

    expect(updateCalls).toHaveLength(0);
  });

  it('skips legacy rows whose finalTwoWeeksDueWeek is null/0/negative', async () => {
    updateCalls.length = 0;
    candidates = [
      {
        id: 9001,
        seasonStart: '2024-09-04',
        weekDay: 3,
        finalTwoWeeksDueWeek: null,
        skipDates: [],
        cancelledDates: [],
      },
      {
        id: 9002,
        seasonStart: '2024-09-04',
        weekDay: 3,
        finalTwoWeeksDueWeek: 0,
        skipDates: [],
        cancelledDates: [],
      },
    ];

    await backfillDoublePayDates();

    expect(updateCalls).toHaveLength(0);
  });
});
