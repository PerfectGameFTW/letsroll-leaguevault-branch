import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { WEEKDAYS, PAYMENT_MODES, nameSchema, positiveIntSchema, dateSchema, timeSchema } from "./constants";
import { organizations } from "./organizations";
import { locations } from "./locations";

export const leagues = pgTable("leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  seasonStart: timestamp("season_start", { mode: "date" }).notNull(),
  seasonEnd: timestamp("season_end", { mode: "date" }).notNull(),
  weekDay: text("week_day", { enum: WEEKDAYS }).notNull(),
  weeklyFee: integer("weekly_fee").notNull().default(2000),
  lineageFee: integer("lineage_fee"),
  prizeFundFee: integer("prize_fund_fee"),
  practiceStartTime: text("practice_start_time"),
  competitionStartTime: text("competition_start_time"),
  squareLineageItemId: text("square_lineage_item_id"),
  squareLineageItemVariationId: text("square_lineage_item_variation_id"),
  squareLineageItemName: text("square_lineage_item_name"),
  squarePrizeFundItemId: text("square_prize_fund_item_id"),
  squarePrizeFundItemVariationId: text("square_prize_fund_item_variation_id"),
  squarePrizeFundItemName: text("square_prize_fund_item_name"),
  squareCategoryId: text("square_category_id"),
  timezone: text("timezone").default("America/Chicago"),
  finalTwoWeeksDueWeek: integer("final_two_weeks_due_week").default(6),
  paymentMode: text("payment_mode", { enum: PAYMENT_MODES }).notNull().default("weekly"),
  seasonNumber: integer("season_number").notNull().default(1),
  previousSeasonId: integer("previous_season_id"),
  organizationId: integer("organization_id").references(() => organizations.id),
  locationId: integer("location_id").references(() => locations.id),
  totalBowlingWeeks: integer("total_bowling_weeks"),
  skipDates: text("skip_dates").array().notNull().default(sql`'{}'`),
  cancelledDates: text("cancelled_dates").array().notNull().default(sql`'{}'`),
}, (table) => ({
  activeNameIdx: index("leagues_active_name_idx").on(table.active, table.name),
  seasonIdx: index("leagues_season_idx").on(table.seasonStart, table.seasonEnd),
  organizationIdx: index("leagues_organization_idx").on(table.organizationId),
  locationIdx: index("leagues_location_idx").on(table.locationId)
}));

const baseLeagueSchema = createInsertSchema(leagues);

export const insertLeagueSchema = baseLeagueSchema.extend({
  name: nameSchema,
  description: z.string().nullable().optional(),
  active: z.boolean().default(true),
  seasonStart: dateSchema,
  seasonEnd: dateSchema,
  weekDay: z.enum(WEEKDAYS),
  weeklyFee: positiveIntSchema.default(2000),
  lineageFee: z.number().int().min(0).nullable().optional(),
  prizeFundFee: z.number().int().min(0).nullable().optional(),
  practiceStartTime: timeSchema.optional(),
  competitionStartTime: timeSchema.optional(),
  timezone: z.string().default("America/Chicago"),
  squareLineageItemId: z.string().nullable().optional(),
  squareLineageItemVariationId: z.string().nullable().optional(),
  squareLineageItemName: z.string().nullable().optional(),
  squarePrizeFundItemId: z.string().nullable().optional(),
  squarePrizeFundItemVariationId: z.string().nullable().optional(),
  squarePrizeFundItemName: z.string().nullable().optional(),
  squareCategoryId: z.string().nullable().optional(),
  locationId: z.number().int().positive().nullable().optional(),
  seasonNumber: z.number().int().positive().default(1),
  previousSeasonId: z.number().int().positive().nullable().optional(),
  paymentMode: z.enum(PAYMENT_MODES).default("weekly"),
  totalBowlingWeeks: z.number().int().positive().nullable().optional(),
  skipDates: z.array(z.string()).default([]),
  cancelledDates: z.array(z.string()).default([]),
}).omit({ id: true })
  .refine(
    (data) => data.seasonEnd > data.seasonStart,
    "Season end date must be after season start date"
  )
  .refine(
    (data) => {
      const lf = data.lineageFee;
      const pf = data.prizeFundFee;
      if (lf != null || pf != null) {
        if (lf == null || pf == null) return false;
        return lf + pf === data.weeklyFee;
      }
      return true;
    },
    { message: "Lineage fee and prize fund fee must both be set and sum to the weekly fee", path: ["lineageFee"] }
  );

export const partialLeagueSchema = z.object({
  name: nameSchema,
  description: z.string().nullable(),
  active: z.boolean(),
  seasonStart: dateSchema,
  seasonEnd: dateSchema,
  weekDay: z.enum(WEEKDAYS),
  weeklyFee: positiveIntSchema,
  lineageFee: z.number().int().min(0).nullable(),
  prizeFundFee: z.number().int().min(0).nullable(),
  practiceStartTime: timeSchema,
  competitionStartTime: timeSchema,
  timezone: z.string(),
  squareLineageItemId: z.string().nullable(),
  squareLineageItemVariationId: z.string().nullable(),
  squareLineageItemName: z.string().nullable(),
  squarePrizeFundItemId: z.string().nullable(),
  squarePrizeFundItemVariationId: z.string().nullable(),
  squarePrizeFundItemName: z.string().nullable(),
  squareCategoryId: z.string().nullable(),
  locationId: z.number().int().positive().nullable(),
  paymentMode: z.enum(PAYMENT_MODES),
  totalBowlingWeeks: z.number().int().positive().nullable(),
  skipDates: z.array(z.string()),
  cancelledDates: z.array(z.string()),
}).partial().refine(
  (data) => {
    if (data.seasonStart && data.seasonEnd) {
      return data.seasonEnd > data.seasonStart;
    }
    return true;
  },
  "Season end date must be after season start date"
).refine(
  (data) => {
    const lf = data.lineageFee;
    const pf = data.prizeFundFee;
    const wf = data.weeklyFee;
    if (lf != null || pf != null) {
      if (lf == null || pf == null) return false;
      if (wf != null && lf + pf !== wf) return false;
    }
    return true;
  },
  { message: "Lineage fee and prize fund fee must both be set and sum to the weekly fee", path: ["lineageFee"] }
);

export type League = typeof leagues.$inferSelect;
export type InsertLeague = z.infer<typeof insertLeagueSchema>;
