/**
 * One-off migration script: backfills Square customer records for bowlers
 * that don't have a squareCustomerId yet.
 *
 * IMPORTANT: This script reads credentials from environment variables and
 * must be run once per location with that location's own Square credentials.
 * Set SQUARE_ACCESS_TOKEN to the target location's access token before running.
 * Do NOT run with a global or shared token — records will land in the wrong account.
 *
 * Usage:
 *   SQUARE_ACCESS_TOKEN=<location_token> npx tsx server/scripts/create-square-customers.ts
 */
import { Client, Environment } from "square";
import { db } from "../db";
import { bowlers } from "@shared/schema";
import { eq, isNull } from "drizzle-orm";

const accessToken = (process.env.SQUARE_ACCESS_TOKEN || '').replace(/[^\x20-\x7E]/g, '').trim();

if (!accessToken) {
  console.error('ERROR: SQUARE_ACCESS_TOKEN is required. Set it to the target location\'s Square access token.');
  process.exit(1);
}

const isProductionToken = accessToken.startsWith('EAAAEv') || accessToken.startsWith('EAAAl7');

const squareClient = new Client({
  accessToken,
  environment: isProductionToken ? Environment.Production : Environment.Sandbox,
});

console.log(`Running in ${isProductionToken ? 'PRODUCTION' : 'SANDBOX'} mode.`);

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createSquareCustomers() {
  try {
    const bowlersWithoutSquareId = await db
      .select()
      .from(bowlers)
      .where(isNull(bowlers.squareCustomerId));

    console.log(`Found ${bowlersWithoutSquareId.length} bowlers without Square Customer IDs`);

    let successCount = 0;
    let errorCount = 0;

    for (const bowler of bowlersWithoutSquareId) {
      try {
        if (!bowler.email) {
          console.log(`Skipping bowler ${bowler.name} - no email address`);
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
            .set({ squareCustomerId: response.result.customer.id })
            .where(eq(bowlers.id, bowler.id));

          console.log(`Created Square Customer for ${bowler.name} (ID: ${response.result.customer.id})`);
          successCount++;
        }

        await sleep(100);
      } catch (error: any) {
        console.error(`Error creating Square Customer for ${bowler.name}:`, error);
        errorCount++;

        if (error.statusCode === 429) {
          console.log('Rate limit hit, waiting 5 seconds...');
          await sleep(5000);
        }
      }
    }

    console.log(`
Import complete:
- Total bowlers processed: ${bowlersWithoutSquareId.length}
- Successfully created: ${successCount}
- Errors: ${errorCount}
    `);

  } catch (error) {
    console.error('Fatal error during Square Customer creation:', error);
    process.exit(1);
  }
}

createSquareCustomers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
