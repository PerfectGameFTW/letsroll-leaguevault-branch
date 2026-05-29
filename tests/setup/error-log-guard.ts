/**
 * In-process `[ERROR]` log guard (Task #746).
 *
 * Wraps the singleton `consoleBuffer` from `server/logger` so that every
 * in-process logger write passes through `recordInProcessLogLine`. A
 * passing test that emits an `[ERROR]` line which was NOT declared
 * via `expectErrorLog(...)` fails in the global `afterEach` below,
 * turning silent log pollution into a hard, attributable failure.
 *
 * Wiring: imported (for its side effects) from every project's setup
 * file — `per-worker-setup.ts`, `per-worker-db-only.ts`, and
 * `component-test-setup.ts` — so the guard is active across the whole
 * suite. `scripts/check-error-log-guard-wiring.ts` (pinned by
 * `tests/unit/check-error-log-guard-wiring.test.ts`) statically enforces
 * that those imports stay in place.
 *
 * Boundaries:
 *   - Only the *in-process* logger sink is intercepted. The spawned
 *     Express app is a separate process whose stdout is mirrored
 *     directly in `spawn-test-app.ts` (not via this `consoleBuffer`),
 *     so child-process errors are NOT attributed per-test here; they're
 *     handled by the `LV_TEST_QUIET_APP` knob instead.
 *   - Only `[ERROR]` lines are guarded; `[INFO]`/`[WARN]`/`[DEBUG]`
 *     pass through untouched.
 *   - `LV_DISABLE_ERROR_LOG_GUARD=1` turns the hard failure off (lines
 *     are still printed) for local debugging only — never in CI.
 */
import { afterEach } from 'vitest';
import { consoleBuffer } from '../../server/logger';
import {
  recordInProcessLogLine,
  resetErrorLogState,
  takeUnexpectedErrorLines,
} from '../helpers/expected-error-logs';

type WriteFn = (
  chunk: Buffer | string,
  encoding: string,
  callback: (error?: Error) => void,
) => void;

interface PatchableConsoleBuffer {
  _write: WriteFn;
  [PATCH_MARKER]?: boolean;
}

// Idempotency marker: under `isolate: true` the setup file (and thus
// this module) re-evaluates per test file against a fresh module
// registry + fresh `consoleBuffer`, so we re-patch each time. Under
// `isolate: false` the module is cached, but a `Symbol.for` marker on
// the instance keeps a double-import from double-wrapping `_write`.
const PATCH_MARKER = Symbol.for('leaguevault.test.errorLogGuard.patched');

function installInterceptor(): void {
  // `consoleBuffer` is a Node `Writable`; `_write` is part of its
  // public stream contract, so reaching it is not a type launder.
  const target: PatchableConsoleBuffer = consoleBuffer;
  if (target[PATCH_MARKER]) return;

  const original = target._write.bind(consoleBuffer);
  target._write = function patchedWrite(chunk, encoding, callback) {
    const suppress = recordInProcessLogLine(chunk.toString());
    if (suppress) {
      // Declared-expected error: swallow it so green runs stay quiet.
      callback();
      return;
    }
    // Everything else (non-error lines, and undeclared errors) still
    // prints. Undeclared errors are additionally recorded for the
    // afterEach below to fail on.
    original(chunk, encoding, callback);
  };
  target[PATCH_MARKER] = true;
}

installInterceptor();

const GUARD_DISABLED = process.env.LV_DISABLE_ERROR_LOG_GUARD === '1';

afterEach(() => {
  const unexpected = takeUnexpectedErrorLines();
  resetErrorLogState();
  if (GUARD_DISABLED || unexpected.length === 0) return;

  const lines = unexpected.map((line) => `    ${line}`).join('\n');
  throw new Error(
    `error-log-guard: this passing test emitted ${unexpected.length} ` +
      `undeclared in-process [ERROR] log line(s):\n${lines}\n\n` +
      `If the error is an intentional part of the test, declare it with ` +
      `expectErrorLog(<RegExp | substring>) from ` +
      `tests/helpers/expected-error-logs before the code under test runs. ` +
      `If it is a real regression, fix the underlying error.`,
  );
});
