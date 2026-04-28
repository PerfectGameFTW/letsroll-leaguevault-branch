-- Task #573: Fully remove CardPointe (Fiserv) from LeagueVault and
-- replace it with Clover Ecommerce as the second payment provider
-- alongside Square.
--
-- Nothing was ever processed through CardPointe in production — the
-- shared.PAYMENT_PROVIDERS enum has already been swapped to
-- ('square', 'clover') in shared/schema/locations.ts and the
-- bowlers/payments JSONB columns for Clover have been added in
-- shared/schema/{bowlers,payments}.ts. This migration drops the
-- now-unused CardPointe DB columns entirely.
--
-- The corresponding Clover columns are added by Drizzle's automatic
-- table sync (locations.clover_credentials JSONB and
-- bowlers.clover_customer_id text) on next push; the payments table
-- already carries `clover_charge_id` from the schema definition.
ALTER TABLE "locations"
  DROP COLUMN IF EXISTS "cardpointe_credentials";
--> statement-breakpoint
ALTER TABLE "bowlers"
  DROP COLUMN IF EXISTS "cardpointe_profile_id";
--> statement-breakpoint
ALTER TABLE "payments"
  DROP COLUMN IF EXISTS "cardpointe_retref";
--> statement-breakpoint
ALTER TABLE "payments"
  DROP COLUMN IF EXISTS "cardpointe_authcode";
