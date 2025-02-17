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

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 10, // Reduced from 20 to prevent connection overload
  idleTimeoutMillis: 30000, // Reduced idle timeout to 30 seconds
  connectionTimeoutMillis: 10000, // Increased connection timeout for better stability
  maxUses: 5000, // Reduced from 7500 to prevent stale connections
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000, // Reduced initial delay for faster recovery
});

export const db = drizzle(pool, { 
  schema,
  logger: {
    logQuery: (query, params) => {
      if (!query.includes('pg_stat_activity')) {
        console.log('[Database] Query:', query);
        if (params && params.length > 0) {
          console.log('[Database] Parameters:', params);
        }
      }
    }
  }
});

// Enhanced error handling
pool.on('error', async (err, client) => {
  console.error('[Database] Unexpected error on idle client', err);
  if (client) {
    client.release(true);
  }
  // Attempt to reconnect
  await testConnection(3, 1000);
});

pool.on('connect', (client) => {
  console.log('[Database] New client connected to pool');
  client.on('error', (err) => {
    console.error('[Database] Error on client', err);
  });
});

// Enhanced connection testing with better error handling
export async function testConnection(retries = 3, delay = 1000): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        console.log('[Database] Connection test successful');
        return true;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error(`[Database] Connection attempt ${attempt} failed:`, error);
      if (attempt === retries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return false;
}

// Enhanced cleanup with better error handling
export async function cleanup(): Promise<void> {
  try {
    console.log('[Database] Starting pool cleanup...');
    await pool.end();
    console.log('[Database] Pool cleanup completed');
  } catch (error) {
    console.error('[Database] Error during pool cleanup:', error);
    throw error;
  }
}