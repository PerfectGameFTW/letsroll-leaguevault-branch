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
  // Deterministic per-pool name (Task #722). VITEST_POOL_ID is the
  // integer string vitest assigns to each fork (1-indexed). LV_TEST_RUN_ID
  // is set once by globalSetup and inherited by every spawned fork —
  // including forks vitest recycles between files under `isolate: true`.
  // Combining the two means a recycled fork in the same pool computes
  // the SAME DB name its predecessor used and connects to the existing
  // clone instead of provisioning a fresh one. The `parallel-isolated`
  // project's clone count is therefore bounded by maxForks, not by the
  // number of test files in the project.
  const poolId = process.env.VITEST_POOL_ID ?? '0';
  const runId = process.env.LV_TEST_RUN_ID;
  if (runId && /^[0-9a-f]+$/.test(runId)) {
    return `test_worker_${runId}_pool_${poolId}`;
  }
  // Fallback for paths that bypass globalSetup (e.g. SKIP_TEST_SEED=1):
  // unique-per-spawn name keeps backwards compat at the cost of losing
  // the cross-recycle reuse. Should not hit in normal `npm test`.
  const rand = randomBytes(4).toString('hex');
  return `test_worker_${poolId}_${process.pid}_${rand}`;
}

async function databaseExists(client: pg.PoolClient, dbName: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists`,
    [dbName],
  );
  return rows[0]?.exists ?? false;
}

// Stable advisory-lock key derived from the template DB name. All
// per-worker clones serialise on this lock so two workers never try
// to `CREATE DATABASE … TEMPLATE` concurrently — Postgres forbids
// any other connection (including idle clones) on the source DB
// during a clone, so unsynchronised parallel attempts deadlock with
// "source database … is being accessed by other users".
export const CLONE_ADVISORY_LOCK_KEY = (() => {
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
      // Task #722: with deterministic per-pool DB names, a vitest fork
      // recycle for the same pool ID will compute the same target name
      // its predecessor already cloned. Probe under the advisory lock
      // (so we don't race a sibling pool's CREATE) and short-circuit if
      // the DB already exists. This is the cross-recycle hot path.
      if (await databaseExists(client, targetDb)) {
        return;
      }
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

// Reserved env keys that survive vitest's per-file module-registry reset
// (which `isolate: true` performs) but are still scoped to this fork
// process under `pool: 'forks'`. See Task #719: with `isolate: true` +
// `pool: 'forks'`, a module-level memo is wiped between files within a
// fork, so every file would re-clone the template DB. Stashing the
// resolved DB name / URL / app port in `process.env` keeps the memo
// alive across files within the fork while still being isolated from
// other forks. DON'T move this back to module scope without first
// refactoring `parallel-isolated` files to `vi.hoisted()`.
const ENV_DB_NAME = '__LV_WORKER_DB_NAME__';
const ENV_DB_URL = '__LV_WORKER_DB_URL__';
const ENV_APP_PORT = '__LV_WORKER_APP_PORT__';

let dbPromise: Promise<{ dbName: string; url: string }> | null = null;
let appPromise: Promise<{ app: SpawnedTestApp; dbName: string }> | null = null;

async function initDbOnce(): Promise<{ dbName: string; url: string }> {
  const dbName = workerDbName();
  await cloneTemplate(dbName);
  const url = workerDbUrl(dbName);
  process.env.DATABASE_URL = url;
  process.env.TEST_DATABASE_URL = url;
  process.env[ENV_DB_NAME] = dbName;
  process.env[ENV_DB_URL] = url;
  if (process.env.LV_DEBUG_PERWORKER === '1') {
    const cold = Number(process.env.__LV_DB_COLD_HITS__ ?? '0') + 1;
    process.env.__LV_DB_COLD_HITS__ = String(cold);
    console.log(`[perworker] db COLD pid=${process.pid} pool=${process.env.VITEST_POOL_ID} db=${dbName} cold=${cold}`);
  }
  return { dbName, url };
}

/**
 * Clone the per-worker DB only (no Express spawn). Used by the DB-only
 * setup file for projects that do not make HTTP calls against the
 * spawned app.
 */
export function cloneTemplateForWorker(): Promise<{ dbName: string; url: string }> {
  // Fast path: this fork already cloned a DB on a previous file load.
  // The module-registry reset wiped `dbPromise`, but `process.env`
  // survives. Defence-in-depth equality check guards against a test
  // mutating TEST_DATABASE_URL out from under us.
  const stashedUrl = process.env[ENV_DB_URL];
  const stashedName = process.env[ENV_DB_NAME];
  if (
    stashedUrl &&
    stashedName &&
    process.env.TEST_DATABASE_URL === stashedUrl
  ) {
    process.env.DATABASE_URL = stashedUrl;
    if (process.env.LV_DEBUG_PERWORKER === '1') {
      const hot = Number(process.env.__LV_DB_HOT_HITS__ ?? '0') + 1;
      process.env.__LV_DB_HOT_HITS__ = String(hot);
      console.log(`[perworker] db HOT  pid=${process.pid} pool=${process.env.VITEST_POOL_ID} db=${stashedName} hot=${hot}`);
    }
    return Promise.resolve({ dbName: stashedName, url: stashedUrl });
  }
  if (dbPromise === null) {
    dbPromise = initDbOnce();
  }
  return dbPromise;
}

async function initAppOnce(): Promise<{ app: SpawnedTestApp; dbName: string }> {
  const { dbName, url } = await cloneTemplateForWorker();
  const app = await spawnTestApp({ databaseUrl: url });
  process.env.TEST_BASE_URL = `http://127.0.0.1:${app.port}`;
  process.env[ENV_APP_PORT] = String(app.port);
  if (process.env.LV_DEBUG_PERWORKER === '1') {
    const cold = Number(process.env.__LV_APP_COLD_HITS__ ?? '0') + 1;
    process.env.__LV_APP_COLD_HITS__ = String(cold);
    console.log(`[perworker] app COLD pid=${process.pid} pool=${process.env.VITEST_POOL_ID} appPort=${app.port} cold=${cold}`);
  }

  // Hard backstop: kill the child when the worker exits, even on
  // uncaught exceptions / signal-driven termination. Sync-only API.
  // Only registered on the cold path so we don't pile up N copies per
  // fork as files reload.
  const killer = (): void => {
    try { app.kill(); } catch { /* noop */ }
  };
  process.once('exit', killer);
  process.once('SIGINT', () => { killer(); process.exit(130); });
  process.once('SIGTERM', () => { killer(); process.exit(143); });

  return { app, dbName };
}

export function ensurePerWorkerApp(): Promise<{ app: SpawnedTestApp; dbName: string }> {
  // Fast path: this fork already spawned an app on a previous file
  // load. We return a stub whose `kill` is a no-op — the real killer
  // was registered via `process.once('exit', ...)` on the cold path
  // and survives module-registry resets (it's owned by the OS
  // process, not the module loader).
  const stashedPort = process.env[ENV_APP_PORT];
  const stashedDbName = process.env[ENV_DB_NAME];
  const stashedUrl = process.env[ENV_DB_URL];
  const expectedBaseUrl = stashedPort ? `http://127.0.0.1:${stashedPort}` : '';
  if (
    stashedPort &&
    stashedDbName &&
    stashedUrl &&
    process.env.TEST_DATABASE_URL === stashedUrl &&
    process.env.TEST_BASE_URL === expectedBaseUrl
  ) {
    const port = Number(stashedPort);
    const stub: SpawnedTestApp = {
      pid: -1,
      port,
      kill: () => { /* noop — real killer registered on cold path */ },
    };
    process.env.DATABASE_URL = stashedUrl;
    if (process.env.LV_DEBUG_PERWORKER === '1') {
      const hot = Number(process.env.__LV_APP_HOT_HITS__ ?? '0') + 1;
      process.env.__LV_APP_HOT_HITS__ = String(hot);
      console.log(`[perworker] app HOT  pid=${process.pid} pool=${process.env.VITEST_POOL_ID} appPort=${stashedPort} hot=${hot}`);
    }
    return Promise.resolve({ app: stub, dbName: stashedDbName });
  }
  if (appPromise === null) {
    appPromise = initAppOnce();
  }
  return appPromise;
}

// Top-level await: vitest blocks the test file load until this resolves.
await ensurePerWorkerApp();
