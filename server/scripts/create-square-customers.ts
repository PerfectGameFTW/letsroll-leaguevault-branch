/**
 * One-off migration script: backfills Square customer records for bowlers
 * that don't have a paymentCustomerId yet.
 *
 * IMPORTANT: This script reads credentials from environment variables and
 * must be run once per location with that location's own Square credentials.
 * Set SQUARE_ACCESS_TOKEN to the target location's access token before running.
 * Do NOT run with a global or shared token — records will land in the wrong account.
 *
 * The --locationId flag is required (task #402): every bowler this script
 * touches gets `paymentProviderLocationId` stamped alongside its new
 * `paymentCustomerId` so the account-deletion service can target exactly
 * one processor for saved-card cleanup later, instead of falling back to
 * the slower league-fan-out scan. The location id passed here MUST be the
 * same location whose Square access token is in SQUARE_ACCESS_TOKEN —
 * mismatching them will permanently mis-route future cleanup calls.
 *
 * The --organizationId flag is also required (task #437). Bowlers carry
 * a NOT NULL `organizationId` since task #407, and Square access tokens
 * are issued per location which always belongs to exactly one org. If
 * this script ran globally (its previous behaviour) and an operator
 * supplied one org's token + locationId, the script would happily create
 * Square customers for bowlers owned by *other* organizations and stamp
 * them with this location id — those rows would then be permanently
 * mis-routed for account-deletion cleanup. Requiring --organizationId
 * makes the operator declare which org's bowlers they intend to touch,
 * and the script refuses to start unless the supplied --locationId
 * actually belongs to that org.
 *
 * Usage:
 *   SQUARE_ACCESS_TOKEN=<location_token> npx tsx server/scripts/create-square-customers.ts \
 *     --organizationId=<id> --locationId=<id>
 */
import { Client, Environment } from "square";
import { db, cleanup as closeDbPool } from "../db";
import { bowlers, locations, organizations } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { createLogger } from "../logger";

const log = createLogger("SquareCustomerScript");

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

const accessToken = (process.env.SQUARE_ACCESS_TOKEN || '').replace(/[^\x20-\x7E]/g, '').trim();

if (!accessToken) {
  log.error('SQUARE_ACCESS_TOKEN is required. Set it to the target location\'s Square access token.');
  process.exit(1);
}

const parsedOrgIdFlag = parseIntFlag(process.argv.slice(2), 'organizationId');
if (!parsedOrgIdFlag) {
  log.error('--organizationId=<id> is required so the script only touches bowlers in the org that owns the supplied location/access token. See task #437.');
  process.exit(1);
}
const organizationIdFlag: number = parsedOrgIdFlag;

const parsedLocationIdFlag = parseIntFlag(process.argv.slice(2), 'locationId');
if (!parsedLocationIdFlag) {
  log.error('--locationId=<id> is required so paymentProviderLocationId can be stamped on every imported bowler. See task #402.');
  process.exit(1);
}
const locationIdFlag: number = parsedLocationIdFlag;

const isProductionToken = accessToken.startsWith('EAAAEv') || accessToken.startsWith('EAAAl7');

const squareClient = new Client({
  accessToken,
  environment: isProductionToken ? Environment.Production : Environment.Sandbox,
});

log.info(`Running in ${isProductionToken ? 'PRODUCTION' : 'SANDBOX'} mode against organization ${organizationIdFlag} / location ${locationIdFlag}.`);

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function assertOrganizationExists(orgId: number): Promise<void> {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!row) {
    log.error(`Organization ${orgId} does not exist. Refusing to backfill against a non-existent org.`);
    process.exit(1);
  }
}

async function assertLocationBelongsToOrg(locationId: number, orgId: number): Promise<void> {
  const [row] = await db
    .select({ id: locations.id, organizationId: locations.organizationId })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  if (!row) {
    log.error(`Location ${locationId} does not exist. Refusing to stamp paymentProviderLocationId for a non-existent location.`);
    process.exit(1);
  }
  if (row.organizationId !== orgId) {
    log.error(
      `Location ${locationId} belongs to organization ${row.organizationId}, not the requested organization ${orgId}. ` +
      `Refusing to cross-stamp bowlers in a different org. See task #437.`,
    );
    process.exit(1);
  }
}

async function createSquareCustomers() {
  await assertOrganizationExists(organizationIdFlag);
  await assertLocationBelongsToOrg(locationIdFlag, organizationIdFlag);

  try {
    // Count globally-eligible bowlers first so we can show the operator
    // exactly how many were excluded by the org filter. This is the
    // "safety log line" called out in task #437 — it lets the operator
    // sanity-check that the org/location flags they passed match what
    // they expected before any Square API call is made.
    const globalEligible = await db
      .select({ id: bowlers.id })
      .from(bowlers)
      .where(isNull(bowlers.paymentCustomerId));

    const bowlersWithoutSquareId = await db
      .select()
      .from(bowlers)
      .where(and(
        eq(bowlers.organizationId, organizationIdFlag),
        isNull(bowlers.paymentCustomerId),
      ));

    const excluded = globalEligible.length - bowlersWithoutSquareId.length;
    log.info(
      `Found ${bowlersWithoutSquareId.length} bowlers without Square Customer IDs in organization ${organizationIdFlag} ` +
      `(excluded ${excluded} bowlers in other organizations from a global pool of ${globalEligible.length}).`,
    );

    let successCount = 0;
    let errorCount = 0;

    for (const bowler of bowlersWithoutSquareId) {
      try {
        if (!bowler.email) {
          log.info(`Skipping bowler ${bowler.name} - no email address`);
          errorCount++;
          continue;
        }

        const response = await squareClient.customersApi.createCustomer({
          idempotencyKey: `bowler_${bowler.id}_${Date.now()}`,
          givenName: bowler.name.split(' ')[0],
          familyName: bowler.name.split(' ').slice(1).join(' ') || '.',
          emailAddress: bowler.email,
          referenceId: bowler.id.toString(),
        });

        if (response.result.customer?.id) {
          await db
            .update(bowlers)
            .set({
              paymentCustomerId: response.result.customer.id,
              // Stamp the originating location alongside the saved-card
              // id so account-deletion can target exactly this processor
              // for cleanup later. See task #346 (interactive paths) and
              // task #402 (this bulk path).
              paymentProviderLocationId: locationIdFlag,
            })
            // Defense in depth: even though we already filtered the
            // SELECT by organizationId, re-assert it on the UPDATE so a
            // future change to the loop body (e.g. retry-from-list)
            // can't accidentally write across orgs. See task #437.
            .where(and(
              eq(bowlers.id, bowler.id),
              eq(bowlers.organizationId, organizationIdFlag),
            ));

          log.info(`Created Square Customer for ${bowler.name} (ID: ${response.result.customer.id}, locationId: ${locationIdFlag})`);
          successCount++;
        }

        await sleep(100);
      } catch (error) {
        log.error(`Error creating Square Customer for ${bowler.name}:`, error);
        errorCount++;

        if ((error as { statusCode?: number } | null)?.statusCode === 429) {
          log.info('Rate limit hit, waiting 5 seconds...');
          await sleep(5000);
        }
      }
    }

    log.info(`Import complete: Total bowlers processed: ${bowlersWithoutSquareId.length}, Successfully created: ${successCount}, Errors: ${errorCount}`);

  } catch (error) {
    log.error('Fatal error during Square Customer creation:', error);
    process.exit(1);
  }
}

createSquareCustomers()
  .then(async () => {
    await closeDbPool();
    process.exit(0);
  })
  .catch(async (error) => {
    log.error('Unhandled error:', error);
    await closeDbPool();
    process.exit(1);
  });
