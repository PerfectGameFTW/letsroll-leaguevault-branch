/**
 * Manual cleanup entrypoint for Neon test worker branches (Task #723).
 *
 * Thin wrapper around `cleanupTestDbs()` that REQUIRES Neon-branches
 * mode (NEON_API_KEY + NEON_PROJECT_ID set). Use this when you want
 * to explicitly target the branch backend — e.g. to sweep stragglers
 * after a crashed CI run, without ambiguity about which backend is
 * active.
 *
 * The general-purpose `scripts/cleanup-test-dbs.ts` auto-dispatches
 * between branch and legacy modes; this script is the named, branch-
 * specific manual sweep that the task spec calls for.
 *
 * Refuses to run if Neon creds are absent or branches mode is opted
 * out via `LV_TEST_USE_NEON_BRANCHES=0`.
 */
import { cleanupTestDbs } from './cleanup-test-dbs';
import { getNeonConfig } from '../tests/setup/neon-branches';

async function main(): Promise<void> {
  const cfg = getNeonConfig();
  if (!cfg) {
    console.error(
      '[cleanup-test-branches] Neon-branches mode is not active. ' +
        'Set NEON_API_KEY and NEON_PROJECT_ID (and ensure ' +
        'LV_TEST_USE_NEON_BRANCHES is not "0") to use this script. ' +
        'For legacy CREATE-DATABASE-TEMPLATE cleanup, use ' +
        'scripts/cleanup-test-dbs.ts instead.',
    );
    process.exit(2);
  }
  const dropped = await cleanupTestDbs();
  if (dropped.length === 0) {
    console.log('[cleanup-test-branches] no leftover test_worker_* branches.');
  } else {
    console.log(
      `[cleanup-test-branches] deleted ${dropped.length} branch(es): ${dropped.join(', ')}`,
    );
  }
}

main().catch((err) => {
  console.error('[cleanup-test-branches] failed:', err);
  process.exit(1);
});
