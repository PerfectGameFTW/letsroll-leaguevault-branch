import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });


// Improved error handling with connection state tracking
let isShuttingDown = false;

pool.on('error', (err, client) => {
  console.error('[Database] Unexpected error on idle client', err);
  if (!isShuttingDown && client) {
    try {
      client.release(true);
    } catch (releaseError) {
      console.error('[Database] Error releasing client:', releaseError);
    }
  }
});

pool.on('connect', (client) => {
  console.log('[Database] New client connected to pool');
  client.on('error', (err) => {
    console.error('[Database] Error on client', err);
  });
});

// Improved connection testing with better state management
export async function testConnection(retries = 3, delay = 1000): Promise<boolean> {
  let client = null;
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      client = await pool.connect();
      await client.query('SELECT 1');
      console.log('[Database] Connection test successful');
      return true;
    } catch (error) {
      lastError = error;
      console.error(`[Database] Connection attempt ${attempt} failed:`, error);

      if (attempt === retries) {
        throw lastError;
      }

      await new Promise(resolve => setTimeout(resolve, delay * attempt)); // Exponential backoff
    } finally {
      if (client) {
        try {
          await client.release(false);
        } catch (releaseError) {
          console.error('[Database] Error releasing test connection:', releaseError);
          // Don't throw here - we want to continue cleanup
        }
      }
    }
  }
  return false;
}

// Improved cleanup with better state management
export async function cleanup(): Promise<void> {
  if (isShuttingDown) {
    console.log('[Database] Cleanup already in progress');
    return;
  }

  isShuttingDown = true;
  console.log('[Database] Starting pool cleanup...');

  try {
    // Wait for any in-progress queries to complete (up to 5 seconds)
    await Promise.race([
      pool.end(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Pool cleanup timeout')), 5000)
      )
    ]);

    console.log('[Database] Pool cleanup completed');
  } catch (error) {
    console.error('[Database] Error during pool cleanup:', error);
    // Continue despite errors - best effort cleanup
  } finally {
    isShuttingDown = false;
  }
}