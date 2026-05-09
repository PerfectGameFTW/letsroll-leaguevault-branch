import { pgTable, serial, integer, boolean, timestamp, text, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { bowlers } from "./bowlers";
import { users } from "./users";
import { organizations } from "./organizations";

export const GUARDIAN_RELATIONSHIPS = [
  "parent",
  "guardian",
  "grandparent",
  "other",
] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export const bowlerGuardians = pgTable(
  "bowler_guardians",
  {
    id: serial("id").primaryKey(),
    childBowlerId: integer("child_bowler_id")
      .notNull()
      .references(() => bowlers.id, { onDelete: "cascade" }),
    guardianUserId: integer("guardian_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id),
    relationship: text("relationship", { enum: GUARDIAN_RELATIONSHIPS })
      .notNull()
      .default("guardian"),
    isPrimaryContact: boolean("is_primary_contact").notNull().default(false),
    isPayer: boolean("is_payer").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => ({
    childIdx: index("bowler_guardians_child_idx").on(table.childBowlerId),
    guardianIdx: index("bowler_guardians_guardian_idx").on(table.guardianUserId),
    orgIdx: index("bowler_guardians_org_idx").on(table.organizationId),
    uniquePair: uniqueIndex("bowler_guardians_child_guardian_uniq").on(
      table.childBowlerId,
      table.guardianUserId,
    ),
    uniquePrimaryPerChild: uniqueIndex("bowler_guardians_one_primary_per_child")
      .on(table.childBowlerId)
      .where(sql`${table.isPrimaryContact} = true`),
  }),
);

const baseSchema = createInsertSchema(bowlerGuardians);

export const insertBowlerGuardianSchema = baseSchema
  .extend({
    childBowlerId: z.number().int().positive(),
    guardianUserId: z.number().int().positive(),
    organizationId: z.number().int().positive(),
    relationship: z.enum(GUARDIAN_RELATIONSHIPS).default("guardian"),
    isPrimaryContact: z.boolean().default(false),
    isPayer: z.boolean().default(true),
  })
  .omit({ id: true, createdAt: true });

export const updateBowlerGuardianSchema = z
  .object({
    relationship: z.enum(GUARDIAN_RELATIONSHIPS),
    isPrimaryContact: z.boolean(),
    isPayer: z.boolean(),
  })
  .partial();

export type BowlerGuardian = typeof bowlerGuardians.$inferSelect;
export type InsertBowlerGuardian = z.infer<typeof insertBowlerGuardianSchema>;
export type UpdateBowlerGuardian = z.infer<typeof updateBowlerGuardianSchema>;
