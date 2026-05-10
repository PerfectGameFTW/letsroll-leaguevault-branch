/**
 * Per-worker test DB accessor (Task #700 / Phase 2 of #697).
 *
 * Returns a lazily-constructed Drizzle client bound to
 * `process.env.TEST_DATABASE_URL`. The URL is set by the per-worker
 * `setupFiles` entry in `tests/setup/per-worker-setup.ts` BEFORE any
 * test file imports this module, so the pool is always built against
 * the worker's isolated `test_worker_<id>` database (cloned from the
 * `leaguevault_test_template` template at globalSetup time).
 *
 * Why a separate pool from the singleton in `server/db.ts`?
 * The singleton in this same worker process is also bound to the
 * per-worker DB (we set `process.env.DATABASE_URL` to the same
 * connection string in setup-files), but storage helpers and route
 * handlers reach for it via static import. `getTestDb()` exists so
 * tests can be explicit about hitting their own worker DB without
 * any ambiguity, and so the pool can be sized independently
 * (`max: 10`) without contending with the app's pool.
 *
 * The pool is closed in the per-worker exit hook in
 * `tests/setup/per-worker-setup.ts`.
 */
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@shared/schema';

let pool: pg.Pool | null = null;
let cachedDb: NodePgDatabase<typeof schema> | null = null;

function getPool(): pg.Pool {
  if (pool !== null) return pool;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'getTestDb(): TEST_DATABASE_URL is not set. ' +
        'This usually means tests/setup/per-worker-setup.ts did not run before this import. ' +
        'Confirm vitest.config.ts wires it as a setupFile for the project under test.',
    );
  }
  pool = new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
}

export function getTestDb(): NodePgDatabase<typeof schema> {
  if (cachedDb !== null) return cachedDb;
  cachedDb = drizzle({ client: getPool(), schema });
  return cachedDb;
}

export function getTestPool(): pg.Pool {
  return getPool();
}

export async function closeTestDb(): Promise<void> {
  if (pool === null) return;
  const p = pool;
  pool = null;
  cachedDb = null;
  try {
    await p.end();
  } catch {
    // best-effort
  }
}
