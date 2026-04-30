#!/usr/bin/env tsx
/**
 * Orphan-audit dev-DB leak tripwire (Task #629).
 *
 * Task #608 hardened `tests/api/orphaned-data-audits.test.ts`'s
 * `afterAll` cleanup so the suite stops leaking rows into the shared
 * dev database. Task #616 then backfill-deleted ~3,300 historical
 * leaks plus the related leagues / teams / bowlers / users it had
 * spawned over weeks of silent re-accumulation. Both of those tasks
 * were one-shot fixes — neither installed an automated tripwire that
 * would surface the *next* afterAll regression on the same PR that
 * introduced it.
 *
 * This guard is that tripwire. It counts every "shape" of row that
 * the orphan-audits suite (and only that suite) is supposed to own
 * after the test workflow finishes:
 *
 *   - `orphan_cleanup_audits` rows authored by the seeded vitest
 *     system admin (positively resolved by email + role + name
 *     prefix, mirroring `scripts/cleanup-orphan-audit-test-leaks.ts`).
 *   - `Vitest Audit %`-named leagues, EXCLUDING the deterministic
 *     `Vitest Org A/B Baseline League` fixtures that the seeder owns
 *     across runs (mirrors PROTECTED_LEAGUE_NAMES in the cleanup script).
 *   - `Vitest Audit %`-named teams.
 *   - `Vitest Audit %`-named bowlers.
 *   - `vitest-audit-%`-emailed users.
 *
 * If any of those counts are non-zero, the guard exits 1 and prints
 * a sample of each leaked shape plus the canonical recovery command —
 * the existing `cleanup-orphan-audit-test-leaks.ts` backfill that
 * #616 was built around. That backfill targets the exact same row
 * shapes this guard reads, so an operator can copy-paste the printed
 * commands and the next run of this guard will pass.
 *
 * Why an absolute count and not a delta?
 *   - The dev DB was clean (every count = 0) immediately after #616's
 *     backfill. Any non-zero today is, by construction, a leak that
 *     happened after that cleanup. A delta-against-baseline check
 *     would silently allow the absolute number to grow as long as
 *     each individual run only added a few rows — exactly the slow
 *     re-accumulation #616 had to clean up.
 *   - The cleanup script's recovery is also absolute: it deletes
 *     EVERY matching row regardless of when it was inserted, so a
 *     "fix the regression then run cleanup" loop trivially returns
 *     the dev DB to all-zeroes.
 *
 * Read-only. Uses the same `db` / `pool` exports as the rest of the
 * codebase. No deletes, no schema changes, no seeded fixture writes —
 * if this script ever has to mutate state to do its job, the change
 * belongs in `cleanup-orphan-audit-test-leaks.ts` instead.
 *
 * Usage:
 *   npx tsx scripts/check-no-leaked-audits.ts            # CI mode (exit 1 on leaks)
 *   npx tsx scripts/check-no-leaked-audits.ts --report   # print without failing
 *
 * Sister of `scripts/check-csrf-coverage.ts`,
 * `scripts/check-org-isolation-coverage.ts`,
 * `scripts/check-wire-sanitization.ts`, and
 * `scripts/check-not-found-code.ts`.
 */
import { fileURLToPath } from 'node:url';
import { and, eq, like, notInArray, sql } from 'drizzle-orm';
import { db, pool } from '../server/db';
import {
  bowlers,
  leagues,
  orphanCleanupAudits,
  teams,
  users,
} from '@shared/schema';

/**
 * Mirrors `PROTECTED_LEAGUE_NAMES` in
 * `scripts/cleanup-orphan-audit-test-leaks.ts`. These leagues match
 * the `Vitest Audit %` LIKE pattern but are deterministic per-org
 * baseline fixtures owned by the seeded `vitest-org-a` / `vitest-org-b`
 * orgs, re-used across runs. Counting them as leaks would force the
 * guard to fail forever on a clean DB.
 */
const PROTECTED_LEAGUE_NAMES = [
  'Vitest Org A Baseline League',
  'Vitest Org B Baseline League',
];

/**
 * Email of the seeded vitest system admin. Resolved at runtime with
 * the same `role = 'system_admin'` AND `name LIKE 'Vitest %'`
 * narrowing the cleanup script uses, so a real customer admin who
 * happens to share the email cannot be matched.
 */
const SEEDED_TEST_ADMIN_EMAIL =
  process.env.TEST_ADMIN_EMAIL || 'admin@example.com';

const REPORT_ONLY = process.argv.includes('--report');

interface LeakCounts {
  auditRowsBySeededAdmin: number;
  leagues: number;
  teams: number;
  bowlers: number;
  users: number;
}

interface LeakSamples {
  auditRows: Array<{ id: number; resourceType: string; resourceId: number; action: string; createdAt: Date | string | null }>;
  leagues: Array<{ id: number; name: string; organizationId: number | null }>;
  teams: Array<{ id: number; name: string }>;
  bowlers: Array<{ id: number; name: string }>;
  users: Array<{ id: number; email: string }>;
}

const SAMPLE_LIMIT = 5;

async function resolveSeededAdminId(): Promise<number | null> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.email, SEEDED_TEST_ADMIN_EMAIL),
        eq(users.role, 'system_admin'),
        like(users.name, 'Vitest %'),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Reads the dev DB and returns the current leak counts + samples.
 * Pure read-only — does NOT close the pg pool, does NOT call
 * `process.exit`. Safe to import and call from a vitest globalSetup
 * teardown so the test workflow itself becomes the tripwire.
 */
export async function checkLeakedAudits(): Promise<{
  counts: LeakCounts;
  samples: LeakSamples;
  seededAdminId: number | null;
}> {
  return gather();
}

/**
 * Convenience for the globalSetup teardown caller: returns the
 * formatted operator-facing message (the same banner the CLI prints)
 * so it can be embedded verbatim into the thrown Error. Returns
 * `null` when there are no leaks.
 */
export function formatLeakReport(
  counts: LeakCounts,
  samples: LeakSamples,
  seededAdminId: number | null,
): string | null {
  const total = totalLeaks(counts);
  if (total === 0) return null;
  const lines: string[] = [];
  lines.push(`[check-no-leaked-audits] ${total} leaked orphan-audit row(s) detected after the test suite finished.`);
  lines.push('');
  lines.push('Counts:');
  lines.push(
    `  orphan_cleanup_audits by seeded admin (${SEEDED_TEST_ADMIN_EMAIL}` +
      `${seededAdminId === null ? ', not yet seeded' : `, id=${seededAdminId}`}): ${counts.auditRowsBySeededAdmin}`,
  );
  lines.push(`  'Vitest Audit %' leagues (excluding baselines): ${counts.leagues}`);
  lines.push(`  'Vitest Audit %' teams: ${counts.teams}`);
  lines.push(`  'Vitest Audit %' bowlers: ${counts.bowlers}`);
  lines.push(`  'vitest-audit-%' users: ${counts.users}`);
  if (samples.auditRows.length > 0) {
    lines.push('');
    lines.push(`Sample of leaked orphan_cleanup_audits rows (showing ${samples.auditRows.length}):`);
    for (const a of samples.auditRows) {
      lines.push(`  id=${a.id} resourceType=${a.resourceType} resourceId=${a.resourceId} action=${a.action}`);
    }
  }
  if (samples.leagues.length > 0) {
    lines.push('');
    lines.push(`Sample of leaked leagues (showing ${samples.leagues.length}):`);
    for (const l of samples.leagues) {
      lines.push(`  id=${l.id} org=${l.organizationId ?? 'null'} name=${JSON.stringify(l.name)}`);
    }
  }
  if (samples.teams.length > 0) {
    lines.push('');
    lines.push(`Sample of leaked teams (showing ${samples.teams.length}):`);
    for (const t of samples.teams) {
      lines.push(`  id=${t.id} name=${JSON.stringify(t.name)}`);
    }
  }
  if (samples.bowlers.length > 0) {
    lines.push('');
    lines.push(`Sample of leaked bowlers (showing ${samples.bowlers.length}):`);
    for (const b of samples.bowlers) {
      lines.push(`  id=${b.id} name=${JSON.stringify(b.name)}`);
    }
  }
  if (samples.users.length > 0) {
    lines.push('');
    lines.push(`Sample of leaked users (showing ${samples.users.length}):`);
    for (const u of samples.users) {
      lines.push(`  id=${u.id} email=${JSON.stringify(u.email)}`);
    }
  }
  lines.push('');
  lines.push('Recovery:');
  lines.push('  1. Preview the deletes:');
  lines.push('       npx tsx scripts/cleanup-orphan-audit-test-leaks.ts --dry-run');
  lines.push('  2. Apply them:');
  lines.push('       ALLOW_TEST_CLEANUP=1 npx tsx scripts/cleanup-orphan-audit-test-leaks.ts');
  lines.push('  3. Re-run this guard to confirm everything is back to zero:');
  lines.push('       npx tsx scripts/check-no-leaked-audits.ts');
  lines.push('');
  lines.push(
    "If the leak comes back on the next run, the regression is in tests/api/orphaned-data-audits.test.ts's afterAll cleanup contract " +
      '(the suite #608 hardened). Compare its `inserted.<table>` registry against what the route under test actually writes; ' +
      'a missing entry means the loop never tries to delete the matching audit row.',
  );
  return lines.join('\n');
}

async function gather(): Promise<{ counts: LeakCounts; samples: LeakSamples; seededAdminId: number | null }> {
  const seededAdminId = await resolveSeededAdminId();

  // Audit-row count + sample is conditional on resolving the seeded
  // admin. If the admin doesn't exist, the seeder hasn't run on this
  // DB yet, and there can't be a leak by construction.
  let auditCount = 0;
  let auditSample: LeakSamples['auditRows'] = [];
  if (seededAdminId !== null) {
    const [row] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(orphanCleanupAudits)
      .where(eq(orphanCleanupAudits.adminUserId, seededAdminId));
    auditCount = Number(row?.value ?? 0);
    if (auditCount > 0) {
      auditSample = await db
        .select({
          id: orphanCleanupAudits.id,
          resourceType: orphanCleanupAudits.resourceType,
          resourceId: orphanCleanupAudits.resourceId,
          action: orphanCleanupAudits.action,
          createdAt: orphanCleanupAudits.createdAt,
        })
        .from(orphanCleanupAudits)
        .where(eq(orphanCleanupAudits.adminUserId, seededAdminId))
        .limit(SAMPLE_LIMIT);
    }
  }

  const [lgCount] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(leagues)
    .where(
      and(
        like(leagues.name, 'Vitest Audit %'),
        notInArray(leagues.name, PROTECTED_LEAGUE_NAMES),
      ),
    );
  const lgSample =
    Number(lgCount?.value ?? 0) > 0
      ? await db
          .select({ id: leagues.id, name: leagues.name, organizationId: leagues.organizationId })
          .from(leagues)
          .where(
            and(
              like(leagues.name, 'Vitest Audit %'),
              notInArray(leagues.name, PROTECTED_LEAGUE_NAMES),
            ),
          )
          .limit(SAMPLE_LIMIT)
      : [];

  const [tmCount] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(teams)
    .where(like(teams.name, 'Vitest Audit %'));
  const tmSample =
    Number(tmCount?.value ?? 0) > 0
      ? await db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(like(teams.name, 'Vitest Audit %'))
          .limit(SAMPLE_LIMIT)
      : [];

  const [bwCount] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(bowlers)
    .where(like(bowlers.name, 'Vitest Audit %'));
  const bwSample =
    Number(bwCount?.value ?? 0) > 0
      ? await db
          .select({ id: bowlers.id, name: bowlers.name })
          .from(bowlers)
          .where(like(bowlers.name, 'Vitest Audit %'))
          .limit(SAMPLE_LIMIT)
      : [];

  const [usCount] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(users)
    .where(like(users.email, 'vitest-audit-%'));
  const usSample =
    Number(usCount?.value ?? 0) > 0
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(like(users.email, 'vitest-audit-%'))
          .limit(SAMPLE_LIMIT)
      : [];

  return {
    seededAdminId,
    counts: {
      auditRowsBySeededAdmin: auditCount,
      leagues: Number(lgCount?.value ?? 0),
      teams: Number(tmCount?.value ?? 0),
      bowlers: Number(bwCount?.value ?? 0),
      users: Number(usCount?.value ?? 0),
    },
    samples: {
      auditRows: auditSample,
      leagues: lgSample,
      teams: tmSample,
      bowlers: bwSample,
      users: usSample,
    },
  };
}

function totalLeaks(counts: LeakCounts): number {
  return (
    counts.auditRowsBySeededAdmin +
    counts.leagues +
    counts.teams +
    counts.bowlers +
    counts.users
  );
}

function printReport(
  counts: LeakCounts,
  samples: LeakSamples,
  seededAdminId: number | null,
): void {
  const total = totalLeaks(counts);
  const stream = total === 0 ? console.log : console.error;
  stream('\n[check-no-leaked-audits] dev-DB leak counts:');
  stream(
    `  orphan_cleanup_audits by seeded admin (${SEEDED_TEST_ADMIN_EMAIL}` +
      `${seededAdminId === null ? ', not yet seeded' : `, id=${seededAdminId}`}): ${counts.auditRowsBySeededAdmin}`,
  );
  stream(`  'Vitest Audit %' leagues (excluding baselines):                    ${counts.leagues}`);
  stream(`  'Vitest Audit %' teams:                                            ${counts.teams}`);
  stream(`  'Vitest Audit %' bowlers:                                          ${counts.bowlers}`);
  stream(`  'vitest-audit-%' users:                                            ${counts.users}`);

  if (total === 0) return;

  console.error('\n[check-no-leaked-audits] sample of leaked rows:');
  if (samples.auditRows.length > 0) {
    console.error('  orphan_cleanup_audits:');
    for (const a of samples.auditRows) {
      const createdAtStr =
        a.createdAt === null
          ? 'null'
          : a.createdAt instanceof Date
            ? a.createdAt.toISOString()
            : String(a.createdAt);
      console.error(
        `    id=${a.id} resourceType=${a.resourceType} resourceId=${a.resourceId} action=${a.action} createdAt=${createdAtStr}`,
      );
    }
  }
  if (samples.leagues.length > 0) {
    console.error('  leagues:');
    for (const l of samples.leagues) {
      console.error(`    id=${l.id} org=${l.organizationId ?? 'null'} name=${JSON.stringify(l.name)}`);
    }
  }
  if (samples.teams.length > 0) {
    console.error('  teams:');
    for (const t of samples.teams) {
      console.error(`    id=${t.id} name=${JSON.stringify(t.name)}`);
    }
  }
  if (samples.bowlers.length > 0) {
    console.error('  bowlers:');
    for (const b of samples.bowlers) {
      console.error(`    id=${b.id} name=${JSON.stringify(b.name)}`);
    }
  }
  if (samples.users.length > 0) {
    console.error('  users:');
    for (const u of samples.users) {
      console.error(`    id=${u.id} email=${JSON.stringify(u.email)}`);
    }
  }
}

function printRecoveryHint(): void {
  console.error('\n[check-no-leaked-audits] Recovery:');
  console.error('  1. Preview the deletes:');
  console.error('       npx tsx scripts/cleanup-orphan-audit-test-leaks.ts --dry-run');
  console.error('  2. Apply them:');
  console.error('       ALLOW_TEST_CLEANUP=1 npx tsx scripts/cleanup-orphan-audit-test-leaks.ts');
  console.error('  3. Re-run this guard to confirm everything is back to zero:');
  console.error('       npx tsx scripts/check-no-leaked-audits.ts');
  console.error(
    '\n  If the leak just keeps coming back, the regression is in ' +
      "tests/api/orphaned-data-audits.test.ts's afterAll cleanup contract — that's the suite #608 hardened. " +
      "Compare its `inserted.<table>` registry against what the route under test actually writes; " +
      'a missing entry means the loop never tries to delete the matching audit row.',
  );
}

async function main(): Promise<void> {
  let exitCode = 0;
  try {
    const { counts, samples, seededAdminId } = await gather();
    printReport(counts, samples, seededAdminId);

    const total = totalLeaks(counts);
    if (total === 0) {
      console.log(
        `\n[check-no-leaked-audits] OK — no leaked orphan-audit fixtures detected in the dev database.`,
      );
    } else {
      console.error(
        `\n[check-no-leaked-audits] ${REPORT_ONLY ? 'REPORT' : 'FAIL'} — ${total} leaked orphan-audit row(s) detected. ` +
          'See sample above and recovery steps below.',
      );
      printRecoveryHint();
      if (!REPORT_ONLY) exitCode = 1;
    }
  } catch (err) {
    console.error('[check-no-leaked-audits] FAIL — query error:', err);
    exitCode = 2;
  } finally {
    await pool.end();
  }
  process.exit(exitCode);
}

/**
 * Only run the CLI when invoked directly (e.g. `npx tsx scripts/...`).
 * Importing this module from a vitest globalSetup teardown must NOT
 * trigger `pool.end()` / `process.exit` — vitest owns that lifecycle.
 */
const isDirectInvocation = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isDirectInvocation) {
  void main();
}
