/**
 * Vitest globalSetup (Task #700 / Phase 2 of #697).
 *
 * Runs once before any worker spawns:
 *   1. `cleanupTestDbs()`   — drops any leftover `test_worker_*`
 *      databases from previous crashed runs.
 *   2. `ensureTestTemplate()` — rebuilds the `leaguevault_test_template`
 *      database if the schema-input hash drifted (or the hash file is
 *      missing). Idempotent fast-path when up-to-date.
 *
 * Per-worker DB clone + Express spawn is performed lazily by
 * `tests/setup/per-worker-setup.ts` (wired as a project setupFile in
 * `vitest.config.ts`) so each worker can build its own isolated DB
 * the first time it loads a test file.
 *
 * Teardown:
 *   - `cleanupTestDbs()` again — drops the per-worker DBs that were
 *     created during this run. (Per-worker child processes are killed
 *     synchronously by their own `process.on('exit')` hook.)
 *   - `closeDbPool()` to end the singleton pool so the event loop can
 *     exit cleanly.
 *
 * Skipped automatically when `SKIP_TEST_SEED=1`.
 */
import { randomBytes } from 'node:crypto';
import { cleanupTestDbs } from '../../scripts/cleanup-test-dbs';
import { ensureTestTemplate } from '../../scripts/ensure-test-template';
import { cleanup as closeDbPool } from '../../server/db';

// Vitest invokes `globalSetup` once per project (we have ≥3 node
// projects). Without memoisation the second project's `cleanupTestDbs()`
// would drop the worker databases the FIRST project's workers had just
// finished cloning — the visible symptom is `database "test_worker_…"
// does not exist` errors when the spawned per-worker app boots. We
// guard via process.env so the marker survives across this file's
// re-imports under each project.
const SETUP_DONE_MARKER = '__LV_GLOBAL_SETUP_DONE__';
const RUN_ID_ENV = 'LV_TEST_RUN_ID';

export default async function setup() {
  if (process.env.SKIP_TEST_SEED !== '1' && !process.env[SETUP_DONE_MARKER]) {
    process.env[SETUP_DONE_MARKER] = '1';
    // Stable per-run identifier inherited by every spawned vitest fork
    // (including forks recycled by `isolate: true` mid-run). Per-worker
    // setup uses this to build a deterministic per-pool DB name so that
    // a recycled fork in the same pool reuses its sibling's clone
    // instead of cloning a fresh DB every file. See per-worker-setup.ts
    // (Task #722).
    if (!process.env[RUN_ID_ENV]) {
      process.env[RUN_ID_ENV] = randomBytes(4).toString('hex');
    }
    await cleanupTestDbs();
    await ensureTestTemplate();
  }

  return async function teardown() {
    // We deliberately do NOT call cleanupTestDbs() here. Vitest may fire
    // this teardown per-project — i.e. before sibling projects' workers
    // have finished — and the cleanup script terminates connections to
    // every `test_worker_*` DB before dropping it, which yanks live DBs
    // out from under in-flight workers. Per-worker setup registers
    // process.exit/SIGINT/SIGTERM hooks that drop their own DB; the
    // next run's startup `cleanupTestDbs()` sweeps any stragglers.
    try {
      await closeDbPool();
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  };
}
