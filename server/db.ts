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
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 60000, // Increased idle timeout to 1 minute
  connectionTimeoutMillis: 5000, // Increased connection timeout to 5 seconds
  maxUses: 7500, // Maximum number of times a client can be used before being recycled
  keepAlive: true, // Enable keep-alive
  keepAliveInitialDelayMillis: 10000, // Initial delay for keep-alive
});
export const db = drizzle(pool, { 
  schema,
  logger: {
    logQuery: (query, params) => {
      if (!query.includes('pg_stat_activity')) { // Don't log health check queries
        console.log('[Database] Query:', query);
        if (params && params.length > 0) {
          console.log('[Database] Parameters:', params);
        }
      }
    }
  }
});

pool.on('error', (err, client) => {
  console.error('[Database] Unexpected error on idle client', err);
  if (client) {
    client.release(true); // Force release the client
  }
});

pool.on('connect', (client) => {
  console.log('[Database] New client connected to pool');
  client.on('error', (err) => {
    console.error('[Database] Error on client', err);
  });
});

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