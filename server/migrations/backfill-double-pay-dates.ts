import { db } from "../db";
import { leagues } from "@shared/schema";
import { sql } from "drizzle-orm";
import { createLogger } from "../logger";
import { getBowlingDateByWeekNumber, toIsoDateStr } from "@shared/schedule-utils";

const log = createLogger("DoublePayBackfill");

/**
 * Task #646 — one-time backfill that converts every legacy
 * `final_two_weeks_due_week` value into two `double_pay_dates`
 * entries (the bowling-week-N date and the bowling-week-(N-1) date).
 *
 * Truly one-time per league: after a successful seed we **also null
 * out `final_two_weeks_due_week`** in the same UPDATE so the WHERE
 * clause never matches that row again. This prevents a "re-seed on
 * restart" regression where an admin clears `doublePayDates` (sets
 * 0 double-pay weeks) and the next server start would otherwise
 * re-derive the legacy 2 dates from the still-populated legacy
 * column. Skipped leagues (missing `weekDay`/`seasonStart`, or no
 * derivable date because the week resolves to a cancelled/skip-only
 * window) keep their legacy value so a future seasonStart edit can
 * re-trigger the seed; they will be tried on the next startup.
 */
export async function backfillDoublePayDates(): Promise<void> {
  const candidates = await db
    .select({
      id: leagues.id,
      seasonStart: leagues.seasonStart,
      weekDay: leagues.weekDay,
      finalTwoWeeksDueWeek: leagues.finalTwoWeeksDueWeek,
      skipDates: leagues.skipDates,
      cancelledDates: leagues.cancelledDates,
    })
    .from(leagues)
    .where(sql`${leagues.finalTwoWeeksDueWeek} IS NOT NULL AND coalesce(array_length(${leagues.doublePayDates}, 1), 0) = 0`);

  if (candidates.length === 0) {
    log.info("No leagues need double-pay backfill");
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const lg of candidates) {
    const week = lg.finalTwoWeeksDueWeek;
    if (week == null || week < 1) {
      skipped++;
      continue;
    }

    const lastDate = getBowlingDateByWeekNumber(
      lg.seasonStart,
      lg.weekDay,
      week,
      lg.skipDates ?? [],
      lg.cancelledDates ?? []
    );
    const priorDate = week > 1
      ? getBowlingDateByWeekNumber(
          lg.seasonStart,
          lg.weekDay,
          week - 1,
          lg.skipDates ?? [],
          lg.cancelledDates ?? []
        )
      : null;

    const dates: string[] = [];
    if (priorDate) dates.push(toIsoDateStr(priorDate));
    if (lastDate) dates.push(toIsoDateStr(lastDate));

    if (dates.length === 0) {
      log.warn(`Skipping league ${lg.id} — could not derive any double-pay dates from week ${week}`);
      skipped++;
      continue;
    }

    // Set both `doublePayDates` AND null out `finalTwoWeeksDueWeek`
    // atomically so the WHERE clause above never matches this row
    // again on subsequent server starts. This is the "truly one-time
    // per league" guarantee — without nulling the legacy column,
    // an admin clearing `doublePayDates` to [] would let the next
    // restart silently re-seed the same 2 dates and reintroduce
    // unintended 2× charges.
    await db
      .update(leagues)
      .set({ doublePayDates: dates, finalTwoWeeksDueWeek: null })
      .where(sql`${leagues.id} = ${lg.id}`);
    updated++;
  }

  log.info(`Backfilled ${updated} leagues, skipped ${skipped}`);
}
