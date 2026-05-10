/**
 * Side-effect-free home for the worker-DB cloning logic.
 *
 * Extracted from `per-worker-setup.ts` (Task #722 follow-up) so that
 * `tests/setup/global-setup.ts` can pre-clone all per-pool DBs serially
 * without triggering `per-worker-setup.ts`'s top-level
 * `await ensurePerWorkerApp()` side effect (which would try to spawn a
 * test Express from globalSetup, hanging the run).
 *
 * The module exposes:
 *   - `workerDbNameForPool(poolId)`  — deterministic per-pool DB name
 *   - `cloneTemplate(targetDb)`      — single-DB clone with advisory lock
 *   - `precloneAllWorkerDbs(maxPoolId)` — serial preclone called by globalSetup
 *
 * Importing this module must NOT have side effects beyond pulling in
 * `pg`. Specifically: do NOT add a top-level `await` here.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { CLONE_ADVISORY_LOCK_KEY, TEMPLATE_DB_NAME } from './per-worker-lock';

function originalDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('clone-template: DATABASE_URL must be set.');
  }
  return url;
}

function adminUrl(): string {
  const u = new URL(originalDatabaseUrl());
  u.pathname = '/postgres';
  return u.toString();
}

export function workerDbUrl(dbName: string): string {
  const u = new URL(originalDatabaseUrl());
  u.pathname = `/${dbName}`;
  return u.toString();
}

/**
 * Compute the per-fork DB name. Deterministic per pool when LV_TEST_RUN_ID
 * is set by globalSetup (Task #722); falls back to a random suffix for
 * standalone paths that bypass globalSetup (e.g. SKIP_TEST_SEED=1).
 */
export function workerDbName(): string {
  const poolId = process.env.VITEST_POOL_ID ?? '0';
  const runId = process.env.LV_TEST_RUN_ID;
  if (runId && /^[0-9a-f]+$/.test(runId)) {
    return `test_worker_${runId}_pool_${poolId}`;
  }
  const rand = randomBytes(4).toString('hex');
  return `test_worker_${poolId}_${process.pid}_${rand}`;
}

// Reserved env keys that survive vitest's per-file module-registry reset
// (which `isolate: true` performs) but are still scoped to this fork
// process under `pool: 'forks'`. See Task #719.
export const ENV_DB_NAME = '__LV_WORKER_DB_NAME__';
export const ENV_DB_URL = '__LV_WORKER_DB_URL__';

async function databaseExists(client: pg.PoolClient, dbName: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists`,
    [dbName],
  );
  return rows[0]?.exists ?? false;
}

export function workerDbNameForPool(poolId: number | string): string {
  const runId = process.env.LV_TEST_RUN_ID;
  if (!runId || !/^[0-9a-f]+$/.test(runId)) {
    throw new Error(
      'workerDbNameForPool: LV_TEST_RUN_ID must be set by globalSetup',
    );
  }
  return `test_worker_${runId}_pool_${poolId}`;
}

/**
 * Inner clone routine that operates on a caller-supplied admin client
 * with the advisory lock already held. Extracted from `cloneTemplate`
 * so it can be reused by both per-fork (`cloneTemplate`) and serial
 * preclone (`precloneAllWorkerDbs`) callers without duplicating the
 * existence-probe + retry-loop logic. Each caller is responsible for
 * the connect/lock/release ceremony around this function — an earlier
 * "shared client across all N iterations" experiment regressed
 * preclone wall-clock 43s → 180s and was reverted (see Task #722
 * follow-up notes).
 */
async function cloneTemplateOnClient(
  client: pg.PoolClient,
  targetDb: string,
  perfPrefix: { tStart: number; tConnect: number; tLock: number },
): Promise<void> {
  let tProbe = 0;
  let existed = false;
  let attempts = 0;
  try {
    if (await databaseExists(client, targetDb)) {
      existed = true;
      tProbe = Date.now();
      return;
    }
    tProbe = Date.now();
    // Bumped from 12 → 24 after a Neon flake on pool_3 exhausted the
    // smaller budget at ~100s with code 55006 ("source database is
    // being accessed by other users"). Each retry's CREATE costs ~5s,
    // so 24 attempts is a ~2-minute safety net for Neon control-plane
    // hiccups; on the happy path attempts=1 and this loop is a no-op.
    const maxAttempts = 24;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      try {
        if (attempt > 1) {
          try {
            await client.query(
              `SELECT pg_terminate_backend(pid)
                 FROM pg_stat_activity
                WHERE datname = $1
                  AND pid <> pg_backend_pid()`,
              [TEMPLATE_DB_NAME],
            );
          } catch {
            /* role lacks privilege; rely on backoff */
          }
        }
        await client.query(
          `CREATE DATABASE "${targetDb}" TEMPLATE "${TEMPLATE_DB_NAME}"`,
        );
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500 * Math.min(attempt, 12)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  } finally {
    const tEnd = Date.now();
    console.log(
      `[lv-perf] cloneTemplate pool=${process.env.VITEST_POOL_ID ?? 'gs'}` +
        ` pid=${process.pid} db=${targetDb}` +
        ` existed=${existed} attempts=${attempts}` +
        ` connect=${perfPrefix.tConnect - perfPrefix.tStart}ms` +
        ` lock=${perfPrefix.tLock ? perfPrefix.tLock - perfPrefix.tConnect : 0}ms` +
        ` probe=${tProbe ? tProbe - (perfPrefix.tLock || perfPrefix.tConnect) : 0}ms` +
        ` create=${existed || !tProbe ? 0 : tEnd - tProbe}ms` +
        ` total=${tEnd - perfPrefix.tStart}ms`,
    );
  }
}

export async function cloneTemplate(targetDb: string): Promise<void> {
  const tStart = Date.now();
  const adminPool = new pg.Pool({ connectionString: adminUrl(), max: 2 });
  const client = await adminPool.connect();
  const tConnect = Date.now();
  let tLock = 0;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [CLONE_ADVISORY_LOCK_KEY]);
    tLock = Date.now();
    try {
      await cloneTemplateOnClient(client, targetDb, { tStart, tConnect, tLock });
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

// Module-level memo of the cold-path DB clone. Wiped by vitest's
// per-file module-registry reset under `isolate: true`; the env-stash
// fast path in `cloneTemplateForWorker` survives that reset.
let dbPromise: Promise<{ dbName: string; url: string }> | null = null;

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
 * Clone the per-worker DB only (no Express spawn). Used by both the
 * DB-only setup file (`per-worker-db-only.ts`) for projects that don't
 * make HTTP calls AND by the app-spawning `per-worker-setup.ts` as the
 * first step of `initAppOnce`.
 *
 * Lives in this side-effect-free module so `per-worker-db-only.ts` can
 * call it without dragging in `per-worker-setup.ts`'s top-level
 * `await ensurePerWorkerApp()` (which would spawn an Express in
 * DB-only contexts).
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

export async function precloneAllWorkerDbs(maxPoolId: number): Promise<void> {
  const tStart = Date.now();
  // IMPORTANT: each iteration gets its OWN admin pool + client +
  // advisory lock + tear-down. An earlier "shared client across all
  // iterations" version (Task #722 follow-up attempt) regressed the
  // total from 43s to 180s on Neon — every pool then hit 4-9 retries
  // instead of 1-2. The per-iteration tear-down apparently lets the
  // managed Postgres backend release some source-template resource
  // that a long-held admin session keeps pinned. Do not "optimise"
  // by sharing the client without re-running with the profiler.
  for (let poolId = 1; poolId <= maxPoolId; poolId++) {
    if (poolId > 1) {
      // Brief pause to let Neon's control plane release the source
      // template before the next CREATE DATABASE … TEMPLATE …
      // attempt. Without this, pool_N+1 occasionally trips
      // 55006 "source database … is being accessed by other users"
      // because CREATE DATABASE itself opens a transient session
      // against the template that Neon takes a beat to tear down.
      await new Promise((r) => setTimeout(r, 1500));
    }
    await cloneTemplate(workerDbNameForPool(poolId));
  }
  console.log(
    `[lv-perf] preclone-all maxPoolId=${maxPoolId} total=${Date.now() - tStart}ms`,
  );
}
