import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { nameSchema, emailSchema, positiveIntSchema } from "./constants";
import { leagues } from "./leagues";
import { teams } from "./teams";
import { locations } from "./locations";

export const bowlers = pgTable("bowlers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  order: integer("order").notNull().default(0),
  paymentCustomerId: text("payment_customer_id"),
  cardpointeProfileId: text("cardpointe_profile_id"),
  // Records which location's payment processor created the bowler's
  // saved-customer record (`paymentCustomerId` / `cardpointeProfileId`).
  // Set whenever either of those columns is first written and used by
  // the account-deletion service to target exactly one processor for
  // saved-card cleanup instead of fanning out to every location
  // reachable through the bowler's leagues. NULL on legacy rows; the
  // deletion service falls back to the join-based scan in that case.
  // See server/services/account-deletion.ts (collectProviderTargets)
  // and task #346.
  paymentProviderLocationId: integer("payment_provider_location_id").references(() => locations.id, { onDelete: 'set null' }),
  bnContactId: text("bn_contact_id"),
  // Set when a profile-update tried to push the bowler to the payment
  // provider and the call failed for a non-config reason (auth, rate
  // limit, network). Cleared when a subsequent sync attempt succeeds.
  // Used by the admin "retry payment sync" endpoint and surfaced in the
  // PATCH /api/account/profile response so the caller knows the customer
  // record on the provider side may be stale. See server/routes/account.ts.
  paymentSyncPendingAt: timestamp("payment_sync_pending_at", { mode: "string" }),
  // Retry-sweep bookkeeping for `paymentSyncPendingAt` (task #284).
  // `paymentSyncAttempts` counts consecutive failed retries since the
  // flag was set; once it hits the cap the background sweep stops
  // touching the bowler and ops must handle it manually. Reset to 0 on
  // a successful sync. `paymentSyncLastAttemptAt` is the timestamp of
  // the most recent retry attempt and drives exponential backoff
  // between sweep ticks.
  paymentSyncAttempts: integer("payment_sync_attempts").notNull().default(0),
  paymentSyncLastAttemptAt: timestamp("payment_sync_last_attempt_at", { mode: "string" }),
});

// Mirror of `PAYMENT_SYNC_MAX_ATTEMPTS` in
// server/services/payment-customer-sync.ts. Re-exported from a `shared/`
// module so the admin UI can render "attempt N/MAX" without round-tripping
// to the server. Both values must stay in lockstep — see task #320.
export const PAYMENT_SYNC_MAX_ATTEMPTS = 5;

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
  joinedAt: timestamp("joined_at", { mode: "string" }).notNull().defaultNow(),
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
  paymentCustomerId: z.string().nullable().optional(),
  cardpointeProfileId: z.string().nullable().optional(),
  paymentProviderLocationId: z.number().int().positive().nullable().optional(),
  paymentSyncPendingAt: z.string().nullable().optional(),
  paymentSyncAttempts: z.number().int().min(0).optional(),
  paymentSyncLastAttemptAt: z.string().nullable().optional(),
}).omit({ id: true });

export const insertBowlerLeagueSchema = baseBowlerLeagueSchema.extend({
  bowlerId: positiveIntSchema,
  leagueId: positiveIntSchema,
  teamId: positiveIntSchema,
  active: z.boolean().default(true),
  order: z.number().min(0).default(0),
}).omit({ id: true });

export const updateBowlerSchema = z.object({
  name: nameSchema,
  email: z.union([emailSchema, z.literal("")]).nullable(),
  phone: z.string().nullable(),
  active: z.boolean(),
  order: z.number().min(0),
  paymentCustomerId: z.string().nullable(),
  cardpointeProfileId: z.string().nullable(),
  paymentProviderLocationId: z.number().int().positive().nullable(),
  bnContactId: z.string().nullable(),
  paymentSyncPendingAt: z.string().nullable(),
  paymentSyncAttempts: z.number().int().min(0),
  paymentSyncLastAttemptAt: z.string().nullable(),
}).partial();

export const updateBowlerLeagueSchema = z.object({
  bowlerId: positiveIntSchema,
  leagueId: positiveIntSchema,
  teamId: positiveIntSchema,
  active: z.boolean(),
  order: z.number().min(0),
}).partial();

export type Bowler = typeof bowlers.$inferSelect;
export type InsertBowler = z.infer<typeof insertBowlerSchema>;
export type UpdateBowler = z.infer<typeof updateBowlerSchema>;

export type BowlerLeague = typeof bowlerLeagues.$inferSelect;
export type InsertBowlerLeague = z.infer<typeof insertBowlerLeagueSchema>;
export type UpdateBowlerLeague = z.infer<typeof updateBowlerLeagueSchema>;
