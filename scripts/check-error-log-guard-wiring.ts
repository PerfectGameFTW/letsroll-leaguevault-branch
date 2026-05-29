#!/usr/bin/env tsx
/**
 * Error-log-guard wiring guard (Task #746).
 *
 * The in-process `[ERROR]` log guard (`tests/setup/error-log-guard.ts`)
 * only fails noisy tests if it is actually loaded. It is wired by a
 * side-effect `import './error-log-guard'` in every vitest project's
 * setup file. This static check asserts those imports are still in
 * place so a refactor of the setup files can't silently disarm the
 * guard for an entire project.
 *
 * It also asserts the guard module itself still imports the recording
 * plumbing from the helper (a cheap smoke test that the two halves
 * stay connected).
 *
 * Usage:
 *   tsx scripts/check-error-log-guard-wiring.ts            # CI mode (exit 1 on violations)
 *   tsx scripts/check-error-log-guard-wiring.ts --report   # print without failing
 *
 * Pinned by `tests/unit/check-error-log-guard-wiring.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const REPORT_ONLY = process.argv.includes('--report');

// Allow the pinning test to point the check at a synthetic fixture
// tree instead of the real repo.
const BASE = process.env.LV_GUARD_WIRING_BASE
  ? resolve(process.env.LV_GUARD_WIRING_BASE)
  : ROOT;

const GUARD_MODULE = 'tests/setup/error-log-guard.ts';
const HELPER_MODULE = 'tests/helpers/expected-error-logs.ts';

// Every setup file that vitest.config.ts wires as a project `setupFiles`
// entry must import the guard for its side effects.
const SETUP_FILES = [
  'tests/setup/per-worker-setup.ts',
  'tests/setup/per-worker-db-only.ts',
  'tests/setup/component-test-setup.ts',
];

const GUARD_IMPORT_RE = /import\s+['"]\.\/error-log-guard['"]/;

interface Violation {
  file: string;
  reason: string;
}

function readOrNull(absPath: string): string | null {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function main(): void {
  const violations: Violation[] = [];

  for (const rel of SETUP_FILES) {
    const abs = join(BASE, rel);
    const text = readOrNull(abs);
    if (text === null) {
      violations.push({
        file: rel,
        reason: `setup file is missing — cannot confirm the error-log guard is wired.`,
      });
      continue;
    }
    if (!GUARD_IMPORT_RE.test(text)) {
      violations.push({
        file: rel,
        reason:
          `setup file does not import the error-log guard. Add ` +
          `\`import './error-log-guard';\` so the in-process [ERROR] guard ` +
          `is active for this vitest project.`,
      });
    }
  }

  // The guard module must exist and stay connected to the helper's
  // recording plumbing.
  const guardAbs = join(BASE, GUARD_MODULE);
  const guardText = readOrNull(guardAbs);
  if (guardText === null) {
    violations.push({
      file: GUARD_MODULE,
      reason: `guard module is missing.`,
    });
  } else if (
    !guardText.includes('recordInProcessLogLine') ||
    !guardText.includes('takeUnexpectedErrorLines')
  ) {
    violations.push({
      file: GUARD_MODULE,
      reason:
        `guard module no longer drives recordInProcessLogLine / ` +
        `takeUnexpectedErrorLines from the helper; the interceptor is ` +
        `disconnected from the expectation registry.`,
    });
  }

  const helperAbs = join(BASE, HELPER_MODULE);
  if (readOrNull(helperAbs) === null) {
    violations.push({
      file: HELPER_MODULE,
      reason: `helper module is missing.`,
    });
  }

  if (violations.length === 0) {
    console.log(
      `[check-error-log-guard-wiring] OK — ${SETUP_FILES.length} setup file(s) ` +
        `import the guard and the guard/helper pair is intact.`,
    );
    return;
  }

  console.error(
    `\n[check-error-log-guard-wiring] ${
      REPORT_ONLY ? 'REPORT' : 'FAIL'
    } — ${violations.length} wiring problem(s):\n`,
  );
  for (const v of violations) {
    console.error(`  ${relative(BASE, join(BASE, v.file))}`);
    console.error(`      · ${v.reason}`);
  }

  if (!REPORT_ONLY) process.exit(1);
}

main();
