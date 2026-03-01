import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });

let isShuttingDown = false;

pool.on('error', (err, client) => {
  console.error('[Database] Unexpected error on idle client', err);
});

pool.on('connect', (client) => {
  console.log('[Database] New client connected to pool');
  client.on('error', (err) => {
    console.error('[Database] Error on client', err);
  });
});

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

      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error('[Database] Error releasing test connection:', releaseError);
        }
      }
    }
  }
  return false;
}

export async function testCleanup(): Promise<void> {
  console.log('[Database] Starting cleanup test...');

  const client = await pool.connect();

  try {
    await client.query('SELECT 1');
    console.log('[Database] Test query executed successfully');
  } finally {
    client.release();
    console.log('[Database] Client released successfully');
  }

  await cleanup();
  console.log('[Database] Cleanup test completed');
}

export async function cleanup(): Promise<void> {
  if (isShuttingDown) {
    console.log('[Database] Cleanup already in progress');
    return;
  }

  isShuttingDown = true;
  console.log('[Database] Starting pool cleanup...');

  try {
    await Promise.race([
      pool.end(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Pool cleanup timeout')), 5000)
      )
    ]);

    console.log('[Database] Pool cleanup completed');
  } catch (error) {
    console.error('[Database] Error during pool cleanup:', error);
  } finally {
    isShuttingDown = false;
  }
}
