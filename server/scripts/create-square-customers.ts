import { Client, Environment } from "square";
import { db } from "../db";
import { bowlers } from "@shared/schema";
import { eq, isNull } from "drizzle-orm";

if (!process.env.SQUARE_ACCESS_TOKEN) {
  throw new Error("SQUARE_ACCESS_TOKEN environment variable must be set");
}

console.log("Initializing Square client...");
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Sandbox, // Use sandbox environment for testing
});

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSquareConnection(retries = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Testing Square API connection (attempt ${attempt}/${retries})...`);
      const locationResponse = await squareClient.locationsApi.listLocations();
      console.log("Square API connection successful:", locationResponse.result);
      return true;
    } catch (error: any) {
      console.error(`Connection attempt ${attempt} failed:`, error);
      if (error.errors) {
        console.error("Square API Errors:", JSON.stringify(error.errors, null, 2));
      }

      if (attempt === retries) {
        throw new Error("Failed to establish Square API connection after multiple attempts");
      }

      // Wait longer between retries
      await sleep(2000 * attempt);
    }
  }
  return false;
}

async function createSquareCustomers() {
  try {
    // Test connection with retries
    await testSquareConnection();

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

        console.log(`Creating Square Customer for ${bowler.name} (${bowler.email})`);

        // Try to create customer with retries
        let retries = 3;
        let created = false;
        let lastError = null;

        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
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
              created = true;
              break;
            }
          } catch (error: any) {
            lastError = error;
            console.error(`Error creating Square Customer for ${bowler.name} (attempt ${attempt}):`, error);
            if (error.errors) {
              console.error("Square API Errors:", JSON.stringify(error.errors, null, 2));
            }

            // If we hit rate limits, wait longer
            if (error.statusCode === 429) {
              console.log('Rate limit hit, waiting before retry...');
              await sleep(5000 * attempt);
            } else {
              await sleep(2000 * attempt);
            }
          }
        }

        if (!created) {
          errorCount++;
          console.error(`Failed to create Square Customer for ${bowler.name} after ${retries} attempts`);
          if (lastError) throw lastError;
        }

        // Add a small delay between successful creations
        await sleep(500);
      } catch (error: any) {
        console.error(`Error processing bowler ${bowler.name}:`, error);
        errorCount++;
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