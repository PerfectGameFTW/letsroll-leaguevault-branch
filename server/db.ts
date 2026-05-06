import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { env } from "./config";
import { createLogger } from './logger';

const log = createLogger("Database");

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 50,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
export const db = drizzle({ client: pool, schema });

let isShuttingDown = false;

pool.on('error', (err, client) => {
  log.error('Unexpected error on idle client', err);
});

pool.on('connect', (client) => {
  log.info('New client connected to pool');
  client.on('error', (err) => {
    log.error('Error on client', err);
  });
});

export async function testConnection(retries = 3, delay = 1000): Promise<boolean> {
  let client = null;
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      client = await pool.connect();
      await client.query('SELECT 1');
      log.info('Connection test successful');
      return true;
    } catch (error) {
      lastError = error;
      log.error(`Connection attempt ${attempt} failed:`, error);

      if (attempt === retries) {
        throw lastError;
      }

      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          log.error('Error releasing test connection:', releaseError);
        }
      }
    }
  }
  return false;
}


export async function testCleanup(): Promise<void> {
  log.info('Starting cleanup test...');

  const client = await pool.connect();

  try {
    await client.query('SELECT 1');
    log.info('Test query executed successfully');
  } finally {
    client.release();
    log.info('Client released successfully');
  }

  await cleanup();
  log.info('Cleanup test completed');
}

export async function cleanup(): Promise<void> {
  if (isShuttingDown) {
    log.info('Cleanup already in progress');
    return;
  }

  isShuttingDown = true;
  log.info('Starting pool cleanup...');

  const POOL_CLEANUP_TIMEOUT_MS = 5000;
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.end().finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('Pool cleanup timeout')),
          POOL_CLEANUP_TIMEOUT_MS,
        );
        // Don't let this safety-net timer keep the Node event loop
        // alive on its own. If pool.end() resolves quickly we want
        // the process to exit immediately, which is critical for the
        // vitest teardown path (#276).
        timeoutHandle.unref?.();
      }),
    ]);

    log.info('Pool cleanup completed');
  } catch (error) {
    log.error('Error during pool cleanup:', error);
  } finally {
    isShuttingDown = false;
  }
}
