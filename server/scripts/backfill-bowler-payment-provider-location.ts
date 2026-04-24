/**
 * One-shot backfill: stamp `bowlers.paymentProviderLocationId` for
 * legacy rows that were created before task #346 added the column.
 *
 * Why
 * ---
 * `bowlers.paymentProviderLocationId` records the location whose
 * payment processor created the bowler's saved-customer record
 * (`paymentCustomerId` / `cardpointeProfileId`). When an account is
 * deleted the deletion service (`server/services/account-deletion.ts`,
 * `collectProviderTargets`) uses that column to talk to exactly one
 * processor. Rows with the column NULL fall back to the legacy
 * fan-out: the deletion service contacts every payment-configured
 * location reachable through the bowler's league memberships, which
 * is noisier in audit logs and can hit irrelevant processors.
 *
 * For each legacy bowler that has a saved-card record, this script
 * looks at the locations reachable through `bowler_leagues -> leagues
 * -> leagues.location_id`, keeps the ones whose location row has its
 * payment processor configured (matching the writer's logic), and:
 *   - exactly 1 candidate -> writes that location id;
 *   - 0 or >1 candidates  -> leaves the column NULL and logs the row
 *                            so the legacy fan-out keeps handling it.
 *
 * The script is idempotent and safe to re-run: it only ever updates
 * rows where `paymentProviderLocationId IS NULL`.
 *
 * Usage
 * -----
 *   npx tsx server/scripts/backfill-bowler-payment-provider-location.ts          # dry-run
 *   npx tsx server/scripts/backfill-bowler-payment-provider-location.ts --apply  # commit changes
 */
import { db, cleanup as closeDbPool } from '../db';
import {
  bowlers,
  bowlerLeagues,
  leagues,
  locations,
  type Location,
} from '@shared/schema';
import { and, eq, inArray, isNull, isNotNull, or } from 'drizzle-orm';
import { createLogger } from '../logger';

const log = createLogger('BackfillBowlerProviderLocation');

const APPLY = process.argv.includes('--apply');

/**
 * Mirrors the minimum credential set each provider class needs to run
 * a customer-cleanup call:
 *   - Square: `SquarePaymentProvider.getClient()` only requires
 *     `accessToken` (see `server/services/square-provider.ts`); the
 *     Square `locationId` is only needed for payment / order routes,
 *     not customer deletion.
 *   - CardPointe: the `CardPointePaymentProvider` constructor refuses
 *     to instantiate unless all of `merchantId`, `apiUsername`,
 *     `apiPassword`, and `siteUrl` are present (see
 *     `server/services/cardpointe-provider.ts`).
 *
 * Keeping this predicate aligned with the providers means we never
 * stamp a bowler with a location that the deletion service would
 * later reject as not configured.
 */
function isLocationPaymentConfigured(loc: Location): boolean {
  const provider = loc.paymentProvider ?? 'square';
  if (provider === 'square') {
    const c = loc.squareCredentials ?? {};
    return Boolean(c.accessToken && c.accessToken.trim().length > 0);
  }
  if (provider === 'cardpointe') {
    const c = loc.cardpointeCredentials ?? {};
    return Boolean(
      c.merchantId && c.apiUsername && c.apiPassword && c.siteUrl,
    );
  }
  return false;
}

async function main() {
  log.info(`Starting backfill (mode: ${APPLY ? 'APPLY' : 'DRY-RUN'})`);

  const candidates = await db
    .select({
      id: bowlers.id,
      paymentCustomerId: bowlers.paymentCustomerId,
      cardpointeProfileId: bowlers.cardpointeProfileId,
    })
    .from(bowlers)
    .where(
      and(
        isNull(bowlers.paymentProviderLocationId),
        or(
          isNotNull(bowlers.paymentCustomerId),
          isNotNull(bowlers.cardpointeProfileId),
        ),
      ),
    );

  log.info(`Found ${candidates.length} legacy bowler(s) needing backfill`);
  if (candidates.length === 0) {
    return { updated: 0, ambiguous: 0, unreachable: 0 };
  }

  const candidateIds = candidates.map((b) => b.id);

  // Distinct (bowlerId, locationId) reachable through league memberships.
  const reach = await db
    .selectDistinct({
      bowlerId: bowlerLeagues.bowlerId,
      locationId: leagues.locationId,
    })
    .from(bowlerLeagues)
    .innerJoin(leagues, eq(bowlerLeagues.leagueId, leagues.id))
    .where(inArray(bowlerLeagues.bowlerId, candidateIds));

  const reachableLocationIds = new Set<number>();
  const byBowler = new Map<number, Set<number>>();
  for (const r of reach) {
    if (r.locationId == null) continue;
    reachableLocationIds.add(r.locationId);
    let set = byBowler.get(r.bowlerId);
    if (!set) {
      set = new Set();
      byBowler.set(r.bowlerId, set);
    }
    set.add(r.locationId);
  }

  // Pre-load location rows so we can decide "payment-configured" once.
  const locationRows =
    reachableLocationIds.size === 0
      ? []
      : await db
          .select()
          .from(locations)
          .where(inArray(locations.id, [...reachableLocationIds]));

  const configured = new Map<number, boolean>();
  for (const loc of locationRows) {
    configured.set(loc.id, isLocationPaymentConfigured(loc));
  }

  let updated = 0;
  let ambiguous = 0;
  let unreachable = 0;

  for (const bowler of candidates) {
    const reachable = byBowler.get(bowler.id) ?? new Set<number>();
    const eligible = [...reachable].filter((id) => configured.get(id));

    if (eligible.length === 0) {
      unreachable += 1;
      log.info(
        `Bowler ${bowler.id}: no payment-configured location reachable — left NULL`,
      );
      continue;
    }
    if (eligible.length > 1) {
      ambiguous += 1;
      log.info(
        `Bowler ${bowler.id}: ambiguous — ${eligible.length} payment-configured locations reachable (${eligible.join(', ')}) — left NULL`,
      );
      continue;
    }

    const locationId = eligible[0];
    if (APPLY) {
      await db
        .update(bowlers)
        .set({ paymentProviderLocationId: locationId })
        .where(
          and(
            eq(bowlers.id, bowler.id),
            isNull(bowlers.paymentProviderLocationId),
          ),
        );
    }
    updated += 1;
    log.info(
      `Bowler ${bowler.id}: stamped paymentProviderLocationId=${locationId}${APPLY ? '' : ' (dry-run)'}`,
    );
  }

  return { updated, ambiguous, unreachable };
}

main()
  .then((stats) => {
    log.info(
      `Backfill complete. updated=${stats.updated}, ambiguous=${stats.ambiguous}, unreachable=${stats.unreachable}` +
        (APPLY ? '' : ' (DRY-RUN — re-run with --apply to commit)'),
    );
  })
  .catch((err) => {
    log.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
