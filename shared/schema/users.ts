import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { USER_ROLES, userRoleEnum, nameSchema, emailSchema } from "./constants";
import { passwordSchema } from "../password-validation";
import { bowlers } from "./bowlers";
import { organizations } from "./organizations";
import { locations } from "./locations";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  bowlerId: integer("bowler_id").references(() => bowlers.id),
  name: text("name").notNull(),
  phone: text("phone"),
  avatar: text("avatar"),
  role: userRoleEnum('role').notNull().default('user'),
  organizationId: integer("organization_id").references(() => organizations.id),
  locationId: integer("location_id").references(() => locations.id),
  inviteToken: text("invite_token"),
  inviteTokenExpiry: timestamp("invite_token_expiry", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
}, (table) => ({
  organizationIdx: index("users_organization_idx").on(table.organizationId),
  bowlerIdx: index("users_bowler_idx").on(table.bowlerId),
  locationIdx: index("users_location_idx").on(table.locationId),
}));


const baseUserSchema = createInsertSchema(users);

export const insertUserSchema = baseUserSchema.extend({
  email: emailSchema,
  name: nameSchema,
  phone: z.string().optional(),
  role: z.enum(USER_ROLES).optional().default('user'),
  organizationId: z.number().nullable().optional(),
  password: passwordSchema,
  bowlerId: z.number().nullable().optional(),
}).omit({ id: true, createdAt: true });

export const updateUserSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  phone: z.string().nullable(),
  avatar: z.string().nullable(),
  role: z.enum(USER_ROLES),
  organizationId: z.number().nullable(),
  locationId: z.number().nullable(),
  bowlerId: z.number().nullable(),
  password: passwordSchema,
}).partial();

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
