import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { nameSchema, emailSchema, positiveIntSchema } from "./constants";
import { leagues } from "./leagues";
import { teams } from "./teams";

export const bowlers = pgTable("bowlers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  order: integer("order").notNull().default(0),
  squareCustomerId: text("square_customer_id"),
  bnContactId: text("bn_contact_id"),
});

export const bowlerLeagues = pgTable("bowler_leagues", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id")
    .notNull()
    .references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  active: boolean("active").notNull().default(true),
  order: integer("order").notNull().default(0),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (table) => ({
  bowlerIdx: index().on(table.bowlerId),
  leagueIdx: index().on(table.leagueId),
  teamIdx: index().on(table.teamId),
  orderIdx: index().on(table.teamId, table.leagueId, table.order),
  activeBowlerIdx: index("bowler_leagues_active_unique_idx").on(
    table.bowlerId,
    table.leagueId,
    table.teamId,
    table.active
  ),
}));

const baseBowlerSchema = createInsertSchema(bowlers);
const baseBowlerLeagueSchema = createInsertSchema(bowlerLeagues);

export const insertBowlerSchema = baseBowlerSchema.extend({
  name: nameSchema,
  email: z.union([emailSchema, z.literal("")]).optional().nullable(),
  phone: z.string().nullable().optional(),
  active: z.boolean().default(true),
  order: z.number().min(0).default(0),
  squareCustomerId: z.string().nullable().optional(),
}).omit({ id: true });

export const insertBowlerLeagueSchema = baseBowlerLeagueSchema.extend({
  bowlerId: positiveIntSchema,
  leagueId: positiveIntSchema,
  teamId: positiveIntSchema,
  active: z.boolean().default(true),
  order: z.number().min(0).default(0),
}).omit({ id: true });

export const partialBowlerSchema = z.object(baseBowlerSchema.shape).partial();
export const partialBowlerLeagueSchema = z.object(baseBowlerLeagueSchema.shape).partial();

export type Bowler = typeof bowlers.$inferSelect;
export type InsertBowler = z.infer<typeof insertBowlerSchema>;

export type BowlerLeague = typeof bowlerLeagues.$inferSelect;
export type InsertBowlerLeague = z.infer<typeof insertBowlerLeagueSchema>;
