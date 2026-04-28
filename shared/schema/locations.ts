import { pgTable, text, serial, integer, boolean, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { nameSchema } from "./constants";
import { organizations } from "./organizations";

export const PAYMENT_PROVIDERS = ['square', 'clover'] as const;
export type PaymentProviderType = (typeof PAYMENT_PROVIDERS)[number];

export interface LocationSquareCredentials {
  appId?: string;
  accessToken?: string;
  locationId?: string;
}

export const locationSquareCredentialsSchema = z.object({
  appId: z.string().optional(),
  accessToken: z.string().optional(),
  locationId: z.string().optional(),
}).nullable().optional();

export const CLOVER_ENVIRONMENTS = ['sandbox', 'production'] as const;
export type CloverEnvironment = (typeof CLOVER_ENVIRONMENTS)[number];

export interface LocationCloverCredentials {
  apiToken?: string;
  merchantId?: string;
  publicTokenizerKey?: string;
  environment?: CloverEnvironment;
}

export const locationCloverCredentialsSchema = z.object({
  apiToken: z.string().optional(),
  merchantId: z.string().optional(),
  publicTokenizerKey: z.string().optional(),
  environment: z.enum(CLOVER_ENVIRONMENTS).optional(),
}).nullable().optional();

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  squareCredentials: jsonb("square_credentials").$type<LocationSquareCredentials>(),
  cloverCredentials: jsonb("clover_credentials").$type<LocationCloverCredentials>(),
  paymentProvider: text("payment_provider").$type<PaymentProviderType>().default('square'),
}, (table) => ({
  organizationIdx: index("locations_organization_idx").on(table.organizationId),
}));

const baseLocationSchema = createInsertSchema(locations);

export const insertLocationSchema = baseLocationSchema.extend({
  name: nameSchema,
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  phone: z.string().optional(),
  active: z.boolean().default(true),
  organizationId: z.number().int().positive(),
  squareCredentials: locationSquareCredentialsSchema,
  cloverCredentials: locationCloverCredentialsSchema,
  paymentProvider: z.enum(PAYMENT_PROVIDERS).default('square').optional(),
}).omit({ id: true });

export const updateLocationSchema = z.object({
  name: nameSchema,
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zipCode: z.string().nullable(),
  phone: z.string().nullable(),
  active: z.boolean(),
  organizationId: z.number().int().positive(),
  squareCredentials: locationSquareCredentialsSchema,
  cloverCredentials: locationCloverCredentialsSchema,
  paymentProvider: z.enum(PAYMENT_PROVIDERS),
}).partial();

export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type UpdateLocation = z.infer<typeof updateLocationSchema>;
