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
 * Idempotent: only updates leagues whose `double_pay_dates` is empty
 * AND whose `final_two_weeks_due_week` is not null. Re-running after a
 * successful pass is a no-op. Leagues whose dates can't be derived
 * (missing `weekDay`/`seasonStart`, or week-1 backfill resolves to a
 * cancelled/skip-only window) are left untouched and logged.
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

    await db
      .update(leagues)
      .set({ doublePayDates: dates })
      .where(sql`${leagues.id} = ${lg.id}`);
    updated++;
  }

  log.info(`Backfilled ${updated} leagues, skipped ${skipped}`);
}
