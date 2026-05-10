/**
 * Per-worker setup file (Task #700 / Phase 2 of #697).
 *
 * Vitest invokes setupFiles once per *test file*, but we only need to
 * provision the worker DB + spawn the test app once per *worker
 * process*. We memoize the heavy work via a module-level promise that
 * survives across files within the same worker (vitest's "forks" pool
 * gives each worker its own process, and modules are cached by
 * identity within a single Node process).
 *
 * Steps performed once per worker:
 *   1. Read `VITEST_POOL_ID` (provided by vitest workers; non-empty
 *      string like "1", "2", …). Falls back to a random suffix if
 *      missing so the script is still safe to invoke standalone.
 *   2. Build the per-worker DB name `test_worker_<pid>_<id>` and clone
 *      the `leaguevault_test_template` template into it.
 *   3. Set `process.env.DATABASE_URL` AND `process.env.TEST_DATABASE_URL`
 *      to the new DB's connection string. Setting both is critical:
 *      `server/db.ts`'s singleton reads `DATABASE_URL` on first import,
 *      and `tests/setup/test-db.ts` reads `TEST_DATABASE_URL`.
 *   4. Spawn the per-worker test Express via `server/test-entry.ts`
 *      and capture its loopback port.
 *   5. Set `process.env.TEST_BASE_URL=http://127.0.0.1:<port>` so
 *      `tests/helpers.ts` issues HTTP requests at the spawned app.
 *   6. Register a `process.on('exit')` hook that synchronously kills
 *      the spawned child. Async DB drop is handled by globalSetup
 *      teardown via `cleanupTestDbs()`.
 *
 * IMPORTANT: this file MUST NOT import anything from `server/db.ts`
 * (directly or transitively) above the `setEnv()` call, or the
 * singleton pool would bind to the dev DB instead of the worker DB.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { spawnTestApp, type SpawnedTestApp } from './spawn-test-app';

const TEMPLATE_DB_NAME = process.env.TEST_TEMPLATE_DB_NAME ?? 'leaguevault_test_template';

function originalDatabaseUrl(): string {
  // Prefer the operator's configured dev DB URL; setupFiles run before
  // we have rewritten DATABASE_URL so process.env.DATABASE_URL still
  // points at the dev DB at this moment.
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('per-worker-setup: DATABASE_URL must be set to provision a worker DB.');
  }
  return url;
}

function adminUrl(): string {
  const u = new URL(originalDatabaseUrl());
  u.pathname = '/postgres';
  return u.toString();
}

function workerDbUrl(dbName: string): string {
  const u = new URL(originalDatabaseUrl());
  u.pathname = `/${dbName}`;
  return u.toString();
}

function workerDbName(): string {
  // VITEST_POOL_ID is the integer string vitest assigns to each fork
  // (1-indexed). PID + a 4-byte random tail keep the name unique even
  // across re-runs that race the dropper.
  const poolId = process.env.VITEST_POOL_ID ?? '0';
  const rand = randomBytes(4).toString('hex');
  return `test_worker_${poolId}_${process.pid}_${rand}`;
}

// Stable advisory-lock key derived from the template DB name. All
// per-worker clones serialise on this lock so two workers never try
// to `CREATE DATABASE … TEMPLATE` concurrently — Postgres forbids
// any other connection (including idle clones) on the source DB
// during a clone, so unsynchronised parallel attempts deadlock with
// "source database … is being accessed by other users".
const CLONE_ADVISORY_LOCK_KEY = (() => {
  let h = 0;
  for (const c of TEMPLATE_DB_NAME) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return h;
})();

async function cloneTemplate(targetDb: string): Promise<void> {
  const adminPool = new pg.Pool({ connectionString: adminUrl(), max: 2 });
  const client = await adminPool.connect();
  try {
    // Block until any concurrent clone in another worker releases.
    await client.query('SELECT pg_advisory_lock($1)', [CLONE_ADVISORY_LOCK_KEY]);
    try {
      // Drop any leftover/stale connections to the template (build
      // script normally closes its pool, but a previous worker's
      // clone-time admin connection can still be in TIME_WAIT).
      const maxAttempts = 5;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          // NB: we deliberately do NOT call pg_terminate_backend here
          // — Neon's default role lacks the privilege ("permission
          // denied to terminate process"). The advisory lock above
          // serialises clones, so the only sessions that should be on
          // the template are previous clones' admin connections that
          // are about to drop. Retry with backoff if we still race.
          await client.query(
            `CREATE DATABASE "${targetDb}" TEMPLATE "${TEMPLATE_DB_NAME}"`,
          );
          return;
        } catch (err) {
          lastErr = err;
          // "source database is being accessed by other users" — wait
          // briefly for the offending session to drain, then retry.
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [CLONE_ADVISORY_LOCK_KEY]);
      } catch { /* noop */ }
    }
  } finally {
    client.release();
    await adminPool.end();
  }
}

let dbPromise: Promise<{ dbName: string; url: string }> | null = null;
let appPromise: Promise<{ app: SpawnedTestApp; dbName: string }> | null = null;

async function initDbOnce(): Promise<{ dbName: string; url: string }> {
  const dbName = workerDbName();
  await cloneTemplate(dbName);
  const url = workerDbUrl(dbName);
  process.env.DATABASE_URL = url;
  process.env.TEST_DATABASE_URL = url;
  return { dbName, url };
}

/**
 * Clone the per-worker DB only (no Express spawn). Used by the DB-only
 * setup file for projects that do not make HTTP calls against the
 * spawned app.
 */
export function cloneTemplateForWorker(): Promise<{ dbName: string; url: string }> {
  if (dbPromise === null) {
    dbPromise = initDbOnce();
  }
  return dbPromise;
}

async function initAppOnce(): Promise<{ app: SpawnedTestApp; dbName: string }> {
  const { dbName, url } = await cloneTemplateForWorker();
  const app = await spawnTestApp({ databaseUrl: url });
  process.env.TEST_BASE_URL = `http://127.0.0.1:${app.port}`;

  // Hard backstop: kill the child when the worker exits, even on
  // uncaught exceptions / signal-driven termination. Sync-only API.
  const killer = (): void => {
    try { app.kill(); } catch { /* noop */ }
  };
  process.once('exit', killer);
  process.once('SIGINT', () => { killer(); process.exit(130); });
  process.once('SIGTERM', () => { killer(); process.exit(143); });

  return { app, dbName };
}

export function ensurePerWorkerApp(): Promise<{ app: SpawnedTestApp; dbName: string }> {
  if (appPromise === null) {
    appPromise = initAppOnce();
  }
  return appPromise;
}

// Top-level await: vitest blocks the test file load until this resolves.
await ensurePerWorkerApp();
