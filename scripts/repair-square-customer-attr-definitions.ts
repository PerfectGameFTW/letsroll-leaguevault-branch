/**
 * One-shot operator script: repair the seller-scoped Square customer
 * custom-attribute definitions for a given location.
 *
 * Why this exists:
 *   The runtime `syncCustomerLeagueAttributes` path observed a
 *   "stale broken definition" failure mode in production where Square
 *   reports `BAD_REQUEST: No matching definition found for value`
 *   on every upsert against `league_name`, while `create` for the same
 *   key returns "already exists". The most likely cause is a
 *   definition record left behind from an older deploy that used the
 *   now-rejected `developer.squareup.com/schemas/v1/common.json` schema
 *   URI. Square keeps the orphan by name, blocks recreate, and rejects
 *   upserts. The fix is to delete-and-recreate the definition.
 *
 *   This script does that delete-and-recreate against a live seller
 *   for a specific LeagueVault location. After it succeeds, any
 *   bowlers in that location's org that hit the per-bowler retry cap
 *   on `stage: custom_attribute_upsert` need their `payment_sync_attempts`
 *   reset to 0 so the background retry sweep picks them up — pass
 *   `--reset-bowlers` to do that as part of the same run.
 *
 * Usage:
 *   npx tsx scripts/repair-square-customer-attr-definitions.ts \
 *     --locationId=<id> [--reset-bowlers] [--dry-run]
 *
 * Safety:
 *   - `--dry-run` skips both the seller-side delete/create AND the
 *     bowler reset; the script just prints what it would do.
 *   - `--reset-bowlers` ONLY targets bowlers whose
 *     `payment_provider_location_id` matches the supplied locationId
 *     AND whose `payment_sync_attempts >= PAYMENT_SYNC_MAX_ATTEMPTS`
 *     AND who still have a non-null `payment_sync_pending_at`. Vitest
 *     pollution rows are excluded by an explicit `email NOT LIKE
 *     '%@vitest.local'` predicate.
 *   - Repair failures are non-fatal at the per-key level; the script
 *     prints the full per-key result map and exits non-zero on any
 *     failure so CI / operator scripts can detect partial success.
 */
import { and, eq, gte, isNotNull, not, sql } from 'drizzle-orm';
import { db, cleanup as closeDbPool } from '../server/db';
import { bowlers } from '@shared/schema';
import { createLogger } from '../server/logger';
import { getPaymentProvider, ProviderNotConfiguredError } from '../server/services/payment-provider-factory';
import { SquarePaymentProvider } from '../server/services/square-provider';
import { PAYMENT_SYNC_MAX_ATTEMPTS } from '../server/services/payment-customer-sync';

const log = createLogger('SquareCustomAttrRepair');

function parseFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function parseIntFlag(argv: string[], name: string): number | null {
  const long = `--${name}`;
  const longEq = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === long && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      return Number.isInteger(n) && n > 0 ? n : null;
    }
    if (arg.startsWith(longEq)) {
      const n = Number(arg.slice(longEq.length));
      return Number.isInteger(n) && n > 0 ? n : null;
    }
  }
  return null;
}

const argv = process.argv.slice(2);
const locationId = parseIntFlag(argv, 'locationId');
const resetBowlers = parseFlag(argv, 'reset-bowlers');
const dryRun = parseFlag(argv, 'dry-run');

if (!locationId) {
  console.error('Usage: tsx scripts/repair-square-customer-attr-definitions.ts --locationId=<id> [--reset-bowlers] [--dry-run]');
  process.exit(2);
}
// Re-bind into a non-nullable local so the narrowing survives across
// the boundary into `main()` (TS doesn't propagate `never`-narrowing
// through subsequent function-scoped reads of a module-scope const).
const targetLocationId: number = locationId;

async function main(): Promise<number> {
  log.info('Starting Square customer custom-attribute definition repair', {
    locationId,
    resetBowlers,
    dryRun,
  });

  let provider;
  try {
    provider = await getPaymentProvider(locationId);
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      log.error('No Square provider configured for location', { locationId });
      return 3;
    }
    throw err;
  }
  if (!(provider instanceof SquarePaymentProvider)) {
    log.error('Provider for location is not a SquarePaymentProvider — repair only applies to Square', {
      locationId,
      providerName: provider.providerName,
    });
    return 4;
  }

  if (dryRun) {
    log.info('[dry-run] Would delete + recreate league_name and league_season custom attribute definitions on the seller account');
  } else {
    const result = await provider.repairCustomerAttributeDefinitions();
    log.info('Repair complete', { locationId, result });
    const anyFailed = Object.values(result).some((ok) => !ok);
    if (anyFailed) {
      log.error('At least one definition repair failed; see per-key result above', { result });
      return 5;
    }
  }

  if (resetBowlers) {
    // Only touch bowlers in the SAME org as the location, that match
    // payment_provider_location_id, and that the retry sweep would
    // currently SKIP because attempts hit the cap. Vitest rows are
    // explicitly excluded so test pollution can't shake loose into
    // a real Square write.
    const predicate = and(
      isNotNull(bowlers.paymentSyncPendingAt),
      eq(bowlers.paymentProviderLocationId, targetLocationId),
      gte(bowlers.paymentSyncAttempts, PAYMENT_SYNC_MAX_ATTEMPTS),
      not(sql`${bowlers.email} LIKE '%@vitest.local'`),
    );

    const targets = await db
      .select({
        id: bowlers.id,
        email: bowlers.email,
        attempts: bowlers.paymentSyncAttempts,
      })
      .from(bowlers)
      .where(predicate);

    log.info('Bowlers eligible for reset', {
      locationId,
      count: targets.length,
      ids: targets.map((b) => b.id),
    });

    if (!dryRun && targets.length > 0) {
      // Reset attempts so the sweep picks them up; null out
      // last_attempt so the exponential-backoff predicate fires
      // immediately on the next sweep tick. Leave pending_at as-is
      // (the sweep clears it on success).
      const updated = await db
        .update(bowlers)
        .set({
          paymentSyncAttempts: 0,
          paymentSyncLastAttemptAt: null,
        })
        .where(predicate)
        .returning({ id: bowlers.id });
      log.info('Reset bowler retry counters', {
        locationId,
        count: updated.length,
        ids: updated.map((b) => b.id),
      });
    } else if (dryRun) {
      log.info('[dry-run] Would reset payment_sync_attempts=0 and payment_sync_last_attempt_at=NULL for above bowlers');
    }
  }

  return 0;
}

main()
  .then(async (code) => {
    await closeDbPool();
    process.exit(code);
  })
  .catch(async (err) => {
    log.error('Repair script failed', {
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    });
    await closeDbPool().catch(() => undefined);
    process.exit(1);
  });
