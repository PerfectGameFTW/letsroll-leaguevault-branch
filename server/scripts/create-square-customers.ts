import { Client, Environment } from "square";
import { db } from "../db";
import { bowlers } from "@shared/schema";
import { eq, isNull } from "drizzle-orm";

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createSquareCustomers() {
  try {
    // Get all bowlers without Square Customer IDs
    const bowlersWithoutSquareId = await db
      .select()
      .from(bowlers)
      .where(isNull(bowlers.squareCustomerId));

    console.log(`Found ${bowlersWithoutSquareId.length} bowlers without Square Customer IDs`);

    let successCount = 0;
    let errorCount = 0;

    for (const bowler of bowlersWithoutSquareId) {
      try {
        // Skip if email is null
        if (!bowler.email) {
          console.log(`Skipping bowler ${bowler.name} - no email address`);
          errorCount++;
          continue;
        }

        // Create customer in Square
        const response = await squareClient.customersApi.createCustomer({
          idempotencyKey: `bowler_${bowler.id}_${Date.now()}`,
          givenName: bowler.name.split(' ')[0],
          familyName: bowler.name.split(' ').slice(1).join(' ') || '.',
          emailAddress: bowler.email,
          referenceId: bowler.id.toString(),
        });

        if (response.result.customer?.id) {
          // Update bowler with Square Customer ID
          await db
            .update(bowlers)
            .set({ squareCustomerId: response.result.customer.id })
            .where(eq(bowlers.id, bowler.id));

          console.log(`Created Square Customer for ${bowler.name} (ID: ${response.result.customer.id})`);
          successCount++;
        }

        // Add a small delay to avoid rate limits
        await sleep(100);
      } catch (error: any) {
        console.error(`Error creating Square Customer for ${bowler.name}:`, error);
        errorCount++;

        // Add a longer delay if we hit rate limits
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

// Run the script
createSquareCustomers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });