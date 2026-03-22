import { pgTable, text, serial, boolean, timestamp, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { nameSchema, emailSchema } from "./constants";

export interface OrgIntegrations {
  bowlnow?: {
    enabled: boolean;
    apiKey?: string;
    locationId?: string;
  };
}

export const orgIntegrationsSchema = z.object({
  bowlnow: z.object({
    enabled: z.boolean(),
    apiKey: z.string().optional(),
    locationId: z.string().optional(),
  }).optional(),
}).nullable().optional();

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  phone: text("phone"),
  email: text("email"),
  logo: text("logo"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  integrations: jsonb("integrations").$type<OrgIntegrations>(),
}, (table) => ({
  slugIdx: uniqueIndex("organization_slug_idx").on(table.slug),
}));

const baseOrganizationSchema = createInsertSchema(organizations);

export const insertOrganizationSchema = baseOrganizationSchema.extend({
  name: nameSchema,
  slug: z.string().min(2, "Slug must be at least 2 characters").regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers, and hyphens"),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.union([emailSchema, z.literal("")]).optional(),
  logo: z.string().optional(),
  active: z.boolean().default(true),
  integrations: orgIntegrationsSchema,
}).omit({ id: true, createdAt: true });

export const updateOrganizationSchema = z.object({
  name: nameSchema,
  slug: z.string().min(2, "Slug must be at least 2 characters").regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers, and hyphens"),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zipCode: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.union([emailSchema, z.literal("")]).nullable(),
  logo: z.string().nullable(),
  active: z.boolean(),
  integrations: orgIntegrationsSchema,
}).partial();

export const partialOrganizationSchema = updateOrganizationSchema;

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
