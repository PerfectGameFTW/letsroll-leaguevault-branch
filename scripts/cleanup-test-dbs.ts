/**
 * Drop any leftover per-worker test databases / branches (Task #699 +
 * Task #723).
 *
 * Two cleanup backends, mirroring the two cloning backends:
 *
 *   1. **Neon Branches API** (Task #723) — when `NEON_API_KEY` and
 *      `NEON_PROJECT_ID` are set, lists every branch whose name
 *      starts with `test_worker_` and deletes it via API. No
 *      advisory-lock dance is needed (Neon serialises branch
 *      operations on its control plane), no in-use safety rail is
 *      needed (deleting a Neon branch tears down its compute and
 *      any open connections cleanly).
 *
 *   2. **Legacy CREATE DATABASE TEMPLATE** — drops `test_worker_%`
 *      databases on the dev host under the same advisory lock
 *      `cloneTemplate()` uses, with the in-use skip safeguard
 *      preserved from #722.
 *
 * Match pattern: `test_worker_*` (branch names) / `test_worker_%` (DB
 * names). Refuses to run unless the dev-DB allow-list rail accepts
 * the connected host (covers both modes — even in Neon-branches mode
 * we don't want this script to talk to a project whose dev URL isn't
 * the registered dev host).
 */
import pg from 'pg';
import { assertSafeDatabaseHost } from '../server/utils/db-safety';
import { CLONE_ADVISORY_LOCK_KEY } from '../tests/setup/per-worker-lock';
import {
  deleteBranch,
  getNeonConfig,
  listBranches,
  WORKER_BRANCH_PREFIX,
} from '../tests/setup/neon-branches';

function adminDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL must be set to clean up test worker databases.');
  }
  const u = new URL(raw);
  u.pathname = '/postgres';
  return u.toString();
}

async function cleanupViaNeonBranches(): Promise<string[]> {
  const cfg = getNeonConfig();
  if (!cfg) throw new Error('cleanupViaNeonBranches called without Neon config');
  const tStart = Date.now();
  const branches = await listBranches(cfg);
  const targets = branches.filter((b) => b.name.startsWith(WORKER_BRANCH_PREFIX));
  const dropped: string[] = [];
  const failed: string[] = [];
  // Parallel deletes — Neon serialises operations on the parent
  // (template) branch internally, but branch *deletions* don't
  // interact with each other.
  await Promise.all(
    targets.map(async (b) => {
      try {
        await deleteBranch(cfg, b.id);
        dropped.push(b.name);
      } catch (err) {
        failed.push(`${b.name} (${err instanceof Error ? err.message : String(err)})`);
      }
    }),
  );
  if (failed.length > 0) {
    console.warn(
      `[cleanup-test-dbs] failed to delete ${failed.length} branch(es): ${failed.join('; ')}`,
    );
  }
  console.log(
    `[lv-perf] cleanupTestDbs mode=neon-branches scanned=${branches.length}` +
      ` targets=${targets.length} dropped=${dropped.length}` +
      ` failed=${failed.length} total=${Date.now() - tStart}ms`,
  );
  return dropped;
}

async function cleanupViaCreateDatabase(): Promise<string[]> {
  const tStart = Date.now();
  const adminPool = new pg.Pool({ connectionString: adminDatabaseUrl(), max: 2 });
  const dropped: string[] = [];
  const skipped: string[] = [];
  // Task #722 hardening: hold the same advisory lock that
  // `cloneTemplate()` uses for the entire scan+drop loop so we close
  // the TOCTOU window between the active-conn probe below and the
  // `DROP DATABASE` — without this, a sibling worker can clone a
  // fresh DB into a name we just observed empty and we'll force-drop
  // it out from under them.
  const lockClient = await adminPool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [CLONE_ADVISORY_LOCK_KEY]);
    const { rows } = await adminPool.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'test_worker_%'`,
    );
    for (const { datname } of rows) {
      try {
        const { rows: usage } = await adminPool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [datname],
        );
        const activeConns = Number(usage[0]?.count ?? '0');
        if (activeConns > 0) {
          skipped.push(`${datname} (${activeConns} active conns)`);
          continue;
        }
        await adminPool.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
        dropped.push(datname);
      } catch (err) {
        console.error(`[cleanup-test-dbs] failed to drop ${datname}:`, err);
      }
    }
    if (skipped.length > 0) {
      console.warn(
        `[cleanup-test-dbs] skipped ${skipped.length} in-use DB(s): ${skipped.join(', ')}`,
      );
    }
    console.log(
      `[lv-perf] cleanupTestDbs mode=legacy scanned=${rows.length} dropped=${dropped.length}` +
        ` skipped=${skipped.length} total=${Date.now() - tStart}ms`,
    );
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [CLONE_ADVISORY_LOCK_KEY]);
    } catch { /* noop */ }
    lockClient.release();
    await adminPool.end();
  }
  return dropped;
}

export async function cleanupTestDbs(): Promise<string[]> {
  assertSafeDatabaseHost('cleanup-test-dbs');
  if (getNeonConfig()) {
    return cleanupViaNeonBranches();
  }
  return cleanupViaCreateDatabase();
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  cleanupTestDbs()
    .then((dropped) => {
      if (dropped.length === 0) {
        console.log('[cleanup-test-dbs] no leftover test_worker_* targets.');
      } else {
        console.log(`[cleanup-test-dbs] dropped ${dropped.length}: ${dropped.join(', ')}`);
      }
    })
    .catch((err) => {
      console.error('[cleanup-test-dbs] failed:', err);
      process.exit(1);
    });
}
