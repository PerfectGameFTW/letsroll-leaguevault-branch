import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { env } from "./config";
import { createLogger } from './logger';

const log = createLogger("Database");

/**
 * Compares two Postgres connection strings on the parts that uniquely
 * identify the underlying database — host (case-insensitive) plus
 * pathname (the `/dbname` segment). Used by both the connection
 * resolver below and `server/utils/db-safety.ts` so the test suite
 * can never accidentally connect to the dev database even when the
 * operator pastes the same URL into both secrets.
 *
 * Returns `true` when the two URLs reference the same physical DB.
 * Returns `false` when either URL fails to parse — the caller is
 * expected to surface a separate "unparseable URL" error in that case.
 */
export function databaseUrlsTargetSameDb(a: string, b: string): boolean {
  let ua: URL;
  let ub: URL;
  try {
    ua = new URL(a);
    ub = new URL(b);
  } catch {
    return false;
  }
  return (
    ua.hostname.toLowerCase() === ub.hostname.toLowerCase() &&
    ua.pathname === ub.pathname
  );
}

/**
 * Picks the Postgres connection string this process should use.
 *
 * Task #662: vitest workers and the dev server's background workers
 * (apple-pay, payment scheduler, square customer sync) used to share
 * the dev DB and race on the same tables. With this resolver in
 * place, any process that boots with `NODE_ENV=test` (vitest,
 * test-only scripts) routes to `TEST_DATABASE_URL` instead. Refuses
 * to start when the test secret is missing or points at the same
 * physical DB as `DATABASE_URL` so a misconfigured CI job fails
 * loudly at boot rather than silently corrupting the dev DB.
 */
export function resolveDatabaseUrl(): string {
  if (env.NODE_ENV === "test") {
    if (!env.TEST_DATABASE_URL) {
      throw new Error(
        "NODE_ENV=test requires TEST_DATABASE_URL to be set. " +
          "Provision a separate Postgres database for the vitest suite, " +
          "push the schema with `DATABASE_URL=$TEST_DATABASE_URL npm run db:push`, " +
          "and store the connection string as the TEST_DATABASE_URL secret. " +
          "See replit.md → Gotchas → Test database isolation.",
      );
    }
    if (databaseUrlsTargetSameDb(env.TEST_DATABASE_URL, env.DATABASE_URL)) {
      throw new Error(
        "TEST_DATABASE_URL points at the same host+database as DATABASE_URL. " +
          "The test suite must run against a dedicated database (Task #662). " +
          "Provision a distinct Postgres DB and update the TEST_DATABASE_URL secret.",
      );
    }
    return env.TEST_DATABASE_URL;
  }
  return env.DATABASE_URL;
}

const connectionString = resolveDatabaseUrl();
if (env.NODE_ENV === "test") {
  // Operator-visible breadcrumb so a developer reading the test log
  // can confirm the suite is hitting the isolated DB. Hostname only —
  // never the full URL, which contains the credential.
  try {
    log.info(`Test mode: connected to TEST_DATABASE_URL host ${new URL(connectionString).hostname}`);
  } catch {
    /* host already validated by resolver; ignore */
  }
}

export const pool = new pg.Pool({
  connectionString,
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
