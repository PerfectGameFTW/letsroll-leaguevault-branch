/**
 * Drop any leftover per-worker test databases (Task #699 / Phase 1).
 *
 * Phase 2's vitest globalSetup will create one
 * `test_worker_<wid>_<rand>` database per worker by cloning the
 * template. Crashes / Ctrl-C can leave those orphaned. This script
 * sweeps them up. Phase 2 will call this at the start of globalSetup
 * before allocating new worker DBs.
 *
 * Match pattern: `test_worker_%`. Refuses to run unless the
 * dev-DB allow-list rail accepts the connected host.
 */
import pg from 'pg';
import { assertSafeDatabaseHost } from '../server/utils/db-safety';
import { CLONE_ADVISORY_LOCK_KEY } from '../tests/setup/per-worker-setup';

function adminDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL must be set to clean up test worker databases.');
  }
  const u = new URL(raw);
  u.pathname = '/postgres';
  return u.toString();
}

export async function cleanupTestDbs(): Promise<string[]> {
  assertSafeDatabaseHost('cleanup-test-dbs');
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
        // Task #722 safety rail: refuse to drop a worker DB that is
        // actively in use by another process. The original (#700)
        // implementation `pg_terminate_backend()`-and-DROPped every
        // `test_worker_*` DB unconditionally, which is fine when only
        // one `npm test` ever runs at a time. In CI / dev shells where
        // the agent restarts the test workflow while the previous run
        // is still tearing down (or where post-merge runs the suite in
        // background), the second run's globalSetup yanks the first
        // run's per-worker DBs out from under live forks, producing
        // the `database "test_worker_…" does not exist` cascade
        // observed in #719's post-merge runs. The advisory lock used
        // by `cloneTemplate()` only serialises CREATE — not DROP.
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
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [CLONE_ADVISORY_LOCK_KEY]);
    } catch { /* noop */ }
    lockClient.release();
    await adminPool.end();
  }
  return dropped;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  cleanupTestDbs()
    .then((dropped) => {
      if (dropped.length === 0) {
        console.log('[cleanup-test-dbs] no leftover test_worker_* databases.');
      } else {
        console.log(`[cleanup-test-dbs] dropped ${dropped.length}: ${dropped.join(', ')}`);
      }
    })
    .catch((err) => {
      console.error('[cleanup-test-dbs] failed:', err);
      process.exit(1);
    });
}
