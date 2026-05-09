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
  try {
    const { rows } = await adminPool.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'test_worker_%'`,
    );
    for (const { datname } of rows) {
      try {
        await adminPool.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [datname],
        );
        await adminPool.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
        dropped.push(datname);
      } catch (err) {
        console.error(`[cleanup-test-dbs] failed to drop ${datname}:`, err);
      }
    }
  } finally {
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
