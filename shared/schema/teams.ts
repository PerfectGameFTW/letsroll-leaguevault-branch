import { pgTable, text, serial, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { nameSchema, positiveIntSchema } from "./constants";
import { leagues } from "./leagues";

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  number: integer("number").notNull(),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  active: boolean("active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
}, (table) => ({
  leagueNumberIdx: uniqueIndex("teams_league_number_idx").on(table.leagueId, table.number),
}));

const baseTeamSchema = createInsertSchema(teams);

export const insertTeamSchema = baseTeamSchema.extend({
  name: nameSchema,
  number: positiveIntSchema,
  leagueId: positiveIntSchema,
  active: z.boolean().default(true),
}).omit({ id: true });

export const updateTeamSchema = z.object({
  name: nameSchema,
  number: positiveIntSchema,
  leagueId: positiveIntSchema,
  active: z.boolean(),
  displayOrder: z.number().min(0),
}).partial();

export const reorderTeamsSchema = z.object({
  teams: z.array(z.object({
    id: z.number(),
    displayOrder: z.number().min(0),
  })),
});

export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type UpdateTeam = z.infer<typeof updateTeamSchema>;
