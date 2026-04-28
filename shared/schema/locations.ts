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

/**
 * Required fields for a fully-configured Clover Ecommerce location.
 * Used by the server `/payments-provider/config` route and by the
 * settings UI to detect partial configurations and surface a clear
 * "Clover not fully configured" message instead of failing silently
 * at checkout. (Task #575.)
 */
export const REQUIRED_CLOVER_FIELDS = [
  'apiToken',
  'merchantId',
  'publicTokenizerKey',
  'environment',
] as const;

export type RequiredCloverField = (typeof REQUIRED_CLOVER_FIELDS)[number];

/**
 * Public/client-facing label for each required Clover field. Kept here
 * so server logs and the settings/payment UIs use identical wording.
 */
export const CLOVER_FIELD_LABELS: Record<RequiredCloverField, string> = {
  apiToken: 'API Token',
  merchantId: 'Merchant ID',
  publicTokenizerKey: 'Public Tokenizer Key',
  environment: 'Environment',
};

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns the list of required Clover fields that are missing from the
 * provided credentials blob. An empty array means the location is
 * fully configured.
 *
 * NOTE: this works on the *raw* credentials shape (with `apiToken`)
 * AND on the public-facing config shape returned by the GET
 * `/locations/:id/clover-config` endpoint (which exposes
 * `apiTokenConfigured: boolean` instead of the secret itself). The
 * latter is detected by the presence of `apiTokenConfigured` and
 * treated as "apiToken present" when true.
 */
export interface CloverConfigStatusInput {
  apiToken?: string | null;
  apiTokenConfigured?: boolean;
  merchantId?: string | null;
  publicTokenizerKey?: string | null;
  environment?: CloverEnvironment | string | null;
}

export function getMissingCloverFields(
  creds: CloverConfigStatusInput | null | undefined,
): RequiredCloverField[] {
  if (!creds) return [...REQUIRED_CLOVER_FIELDS];

  const missing: RequiredCloverField[] = [];

  const hasApiToken = creds.apiTokenConfigured === true || nonEmptyString(creds.apiToken);
  if (!hasApiToken) missing.push('apiToken');
  if (!nonEmptyString(creds.merchantId)) missing.push('merchantId');
  if (!nonEmptyString(creds.publicTokenizerKey)) missing.push('publicTokenizerKey');
  if (!nonEmptyString(creds.environment)) missing.push('environment');

  return missing;
}

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
