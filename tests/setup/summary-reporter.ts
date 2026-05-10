import type { Reporter, TestModule, TestRunEndReason } from 'vitest/node';
import { cleanupTestDbs } from '../../scripts/cleanup-test-dbs';

const RUN_ID_ENV = 'LV_TEST_RUN_ID';

export default class SummaryReporter implements Reporter {
  private startedAt = 0;

  onTestRunStart(): void {
    this.startedAt = Date.now();
  }

  /**
   * End-of-run Neon branch cleanup (Task #723 follow-on).
   *
   * This runs in the main vitest process, after every project has
   * finished and every fork has reported its modules — i.e. exactly
   * once per test run, regardless of how many projects there are or
   * how vitest recycled forks within them. This is the "true
   * run-once-at-process-end" hook the architect asked for.
   *
   * Why not in `globalSetup` teardown: vitest fires that per-project,
   * not per-run, so a fast-finishing project would yank shared
   * per-pool branches out from under sibling projects' workers.
   *
   * Why not per-fork (`process.on('beforeExit')`): vitest projects
   * with `isolate: true` (`parallel-isolated-with-app`,
   * `serial-fk-bypass`) recycle fork processes between files. A
   * per-fork hook fires between every file and deletes the branch
   * that the next file's fresh fork is about to use, breaking the
   * run with `endpoint not found` errors.
   *
   * The cleanup is RUN_ID-scoped so concurrent test runs in other
   * processes (different RUN_ID) are untouched. Best-effort: a
   * failure here is logged but not fatal — the next run's startup
   * sweep is the safety net. Opt-out: `LV_TEST_SKIP_BRANCH_CLEANUP=1`.
   *
   * Legacy CREATE-DATABASE-TEMPLATE mode no-ops inside
   * `cleanupTestDbs` when no Neon creds are present.
   */
  private async runEndOfRunCleanup(): Promise<void> {
    if (process.env.LV_TEST_SKIP_BRANCH_CLEANUP === '1') return;
    const runId = process.env[RUN_ID_ENV];
    if (!runId) return;
    try {
      await cleanupTestDbs({ branchNamePrefix: `test_worker_${runId}_` });
    } catch (err) {
      process.stdout.write(
        `[lv-test-summary] end-of-run cleanup failed (next run sweep will handle): `
        + `${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  async onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    _unhandledErrors: ReadonlyArray<unknown>,
    reason: TestRunEndReason,
  ): Promise<void> {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let filesPassed = 0;
    let filesFailed = 0;
    let filesSkipped = 0;

    for (const mod of modules) {
      const fileState = mod.state();
      if (fileState === 'failed') filesFailed++;
      else if (fileState === 'skipped') filesSkipped++;
      else filesPassed++;

      const tests = Array.from(mod.children.allTests());
      for (const test of tests) {
        const result = test.result();
        const s = result?.state;
        if (s === 'passed') passed++;
        else if (s === 'failed') failed++;
        else if (s === 'skipped' || s === 'pending') skipped++;
      }
    }

    const wallMs = Date.now() - this.startedAt;
    const wallS = (wallMs / 1000).toFixed(2);
    const summary =
      `[lv-test-summary] reason=${reason} ` +
      `files=${filesPassed} passed/${filesFailed} failed/${filesSkipped} skipped ` +
      `tests=${passed} passed/${failed} failed/${skipped} skipped ` +
      `wallMs=${wallMs} (${wallS}s)`;
    process.stdout.write(summary + '\n');

    // End-of-run Neon branch cleanup. Awaited so the process doesn't
    // exit before the API calls complete. See `runEndOfRunCleanup`
    // for full rationale and safety analysis.
    await this.runEndOfRunCleanup();
  }
}
