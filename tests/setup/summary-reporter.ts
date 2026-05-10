import type { Reporter, TestModule, TestRunEndReason } from 'vitest/node';

export default class SummaryReporter implements Reporter {
  private startedAt = 0;

  onTestRunStart(): void {
    this.startedAt = Date.now();
  }

  onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    _unhandledErrors: ReadonlyArray<unknown>,
    reason: TestRunEndReason,
  ): void {
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
  }
}
