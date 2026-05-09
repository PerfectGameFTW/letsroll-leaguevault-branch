/**
 * Build the per-worker test template database (Task #699 / Phase 1).
 *
 * Drops + recreates `leaguevault_test_template` on the same Postgres
 * server pointed at by `DATABASE_URL`, then primes it so Phase 2 can
 * `CREATE DATABASE … TEMPLATE leaguevault_test_template` per vitest
 * worker:
 *   1. `drizzle-kit push --force` against the template.
 *   2. `installDbInvariants(db)` against the template.
 *   3. `seedTestUsers(db)` against the template.
 *   4. Hash of the schema sources is written to
 *      `.local/test-template-hash` so `ensure-test-template.ts` can
 *      decide whether to rebuild on subsequent runs.
 *
 * Safe to run repeatedly. The drop refuses to run against a host
 * the dev-DB allow-list rejects (same `assertSafeDatabaseHost`
 * rail every other destructive script uses).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import pg from 'pg';
import { assertSafeDatabaseHost } from '../server/utils/db-safety';
import { createDbClient } from '../server/db';
import { installDbInvariants } from '../server/db-invariants';
import { seedTestUsers } from '../tests/setup/seed-test-users';

const TEMPLATE_DB_NAME = process.env.TEST_TEMPLATE_DB_NAME ?? 'leaguevault_test_template';
const HASH_FILE = '.local/test-template-hash';

function originalDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set to build the test template database.');
  }
  return url;
}

function templateDatabaseUrl(): string {
  const u = new URL(originalDatabaseUrl());
  u.pathname = `/${TEMPLATE_DB_NAME}`;
  return u.toString();
}

function adminDatabaseUrl(): string {
  // Connect to the Postgres-default `postgres` admin DB to issue
  // DROP/CREATE DATABASE statements (you can't drop the DB you're
  // currently connected to).
  const u = new URL(originalDatabaseUrl());
  u.pathname = '/postgres';
  return u.toString();
}

async function recreateTemplateDb(): Promise<void> {
  const adminPool = new pg.Pool({ connectionString: adminDatabaseUrl(), max: 2 });
  try {
    // Forcibly disconnect any lingering sessions, then drop + create.
    // `WITH (FORCE)` is supported on PG 13+; Neon is on 16.
    await adminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEMPLATE_DB_NAME],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS "${TEMPLATE_DB_NAME}" WITH (FORCE)`);
    await adminPool.query(`CREATE DATABASE "${TEMPLATE_DB_NAME}"`);
  } finally {
    await adminPool.end();
  }
}

function runDrizzlePush(): void {
  const env = { ...process.env, DATABASE_URL: templateDatabaseUrl() };
  const result = spawnSync('npx', ['drizzle-kit', 'push', '--force'], {
    stdio: 'inherit',
    env,
  });
  if (result.status !== 0) {
    throw new Error(`drizzle-kit push failed with exit code ${result.status}`);
  }
}

/**
 * Hash of the inputs that determine whether the template is stale.
 * Bumped whenever `shared/schema/**`, `server/db-invariants.ts`, or
 * `tests/setup/seed-test-users.ts` change.
 */
export function computeTemplateHash(): string {
  const hasher = createHash('sha256');
  const inputs: Array<{ root: string; recursive: boolean }> = [
    { root: 'shared/schema', recursive: true },
    { root: 'server/db-invariants.ts', recursive: false },
    { root: 'tests/setup/seed-test-users.ts', recursive: false },
  ];

  const files: string[] = [];
  for (const { root, recursive } of inputs) {
    let s;
    try {
      s = statSync(root);
    } catch {
      continue;
    }
    if (s.isFile()) {
      files.push(root);
    } else if (s.isDirectory() && recursive) {
      collect(root, files);
    }
  }
  files.sort();
  for (const f of files) {
    hasher.update(relative(process.cwd(), f));
    hasher.update('\0');
    hasher.update(readFileSync(f));
    hasher.update('\0');
  }
  return hasher.digest('hex');
}

function collect(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collect(p, out);
    else if (entry.isFile()) out.push(p);
  }
}

function writeHash(hash: string): void {
  mkdirSync(dirname(HASH_FILE), { recursive: true });
  writeFileSync(HASH_FILE, `${hash}\n`, 'utf8');
}

export async function buildTestTemplate(): Promise<void> {
  // Independent host-allow-list guard: refuse to wipe a database
  // unless the operator's DATABASE_URL is on the dev allow-list.
  assertSafeDatabaseHost('build-test-template');

  console.log(`[build-test-template] dropping + recreating "${TEMPLATE_DB_NAME}"…`);
  await recreateTemplateDb();

  console.log(`[build-test-template] running drizzle-kit push --force against template…`);
  runDrizzlePush();

  const client = createDbClient(templateDatabaseUrl());
  try {
    console.log(`[build-test-template] installing DB invariants…`);
    await installDbInvariants(client.db);
    console.log(`[build-test-template] seeding test users…`);
    await seedTestUsers(client.db);
  } finally {
    await client.close();
  }

  const hash = computeTemplateHash();
  writeHash(hash);
  console.log(`[build-test-template] done. hash=${hash.slice(0, 12)}…`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  buildTestTemplate().catch((err) => {
    console.error('[build-test-template] failed:', err);
    process.exit(1);
  });
}
