/**
 * Pins the in-process [ERROR] log guard's matching/suppression logic
 * (task #746). Drives the helper plumbing
 * (`tests/helpers/expected-error-logs.ts`) directly with synthetic
 * chunks rather than spinning up a real logger, verifying:
 *
 *   - non-[ERROR] lines are ignored (never suppressed, never recorded);
 *   - undeclared [ERROR] lines are recorded as violations and NOT
 *     suppressed (so they stay visible);
 *   - [ERROR] lines matched by `expectErrorLog` (RegExp or substring)
 *     are suppressed and NOT counted as violations;
 *   - `getCapturedErrorLogs` exposes every [ERROR] line for assertions;
 *   - `resetErrorLogState` clears expectations + captures between tests;
 *   - `createMockLogger` records calls for the vi.mock pattern.
 *
 * NOTE: these functions back the *global* guard installed by
 * `tests/setup/error-log-guard.ts`, so each test resets the shared
 * state in a `finally` to avoid leaking a synthetic "unexpected" line
 * into the guard's own afterEach.
 */
import { describe, expect, it } from 'vitest';
import {
  createMockLogger,
  expectErrorLog,
  getCapturedErrorLogs,
  recordInProcessLogLine,
  resetErrorLogState,
  takeUnexpectedErrorLines,
} from '../helpers/expected-error-logs';

function withCleanState(fn: () => void): void {
  resetErrorLogState();
  try {
    fn();
  } finally {
    resetErrorLogState();
  }
}

const ERR = (msg: string) => `[ERROR] [Tag] ${msg} {"k":1}\n`;

describe('error-log guard matching logic', () => {
  it('ignores non-[ERROR] lines entirely', () => {
    withCleanState(() => {
      expect(recordInProcessLogLine('[INFO] [Tag] hello\n')).toBe(false);
      expect(recordInProcessLogLine('[WARN] [Tag] careful\n')).toBe(false);
      expect(recordInProcessLogLine('[DEBUG] [Tag] noisy\n')).toBe(false);
      expect(takeUnexpectedErrorLines()).toEqual([]);
      expect(getCapturedErrorLogs()).toEqual([]);
    });
  });

  it('records an undeclared [ERROR] line as a violation and does not suppress it', () => {
    withCleanState(() => {
      const suppress = recordInProcessLogLine(ERR('boom happened'));
      expect(suppress).toBe(false);
      const unexpected = takeUnexpectedErrorLines();
      expect(unexpected).toHaveLength(1);
      expect(unexpected[0]).toContain('boom happened');
      // trailing newline stripped
      expect(unexpected[0].endsWith('\n')).toBe(false);
    });
  });

  it('suppresses an [ERROR] line declared via a RegExp matcher', () => {
    withCleanState(() => {
      expectErrorLog(/SendGrid 503/);
      const suppress = recordInProcessLogLine(ERR('notification failed: SendGrid 503'));
      expect(suppress).toBe(true);
      expect(takeUnexpectedErrorLines()).toEqual([]);
    });
  });

  it('suppresses an [ERROR] line declared via a substring matcher', () => {
    withCleanState(() => {
      expectErrorLog('gave up after max retry');
      const suppress = recordInProcessLogLine(ERR('payment sync gave up after max retry'));
      expect(suppress).toBe(true);
      expect(takeUnexpectedErrorLines()).toEqual([]);
    });
  });

  it('allowlists repeated emissions of the same expected line', () => {
    withCleanState(() => {
      expectErrorLog(/retrying/);
      expect(recordInProcessLogLine(ERR('retrying attempt 1'))).toBe(true);
      expect(recordInProcessLogLine(ERR('retrying attempt 2'))).toBe(true);
      expect(recordInProcessLogLine(ERR('retrying attempt 3'))).toBe(true);
      expect(takeUnexpectedErrorLines()).toEqual([]);
    });
  });

  it('separates expected from unexpected within the same test', () => {
    withCleanState(() => {
      expectErrorLog(/expected one/);
      expect(recordInProcessLogLine(ERR('this is expected one'))).toBe(true);
      expect(recordInProcessLogLine(ERR('a surprise error'))).toBe(false);
      const unexpected = takeUnexpectedErrorLines();
      expect(unexpected).toHaveLength(1);
      expect(unexpected[0]).toContain('a surprise error');
      // capture sees BOTH lines
      expect(getCapturedErrorLogs()).toHaveLength(2);
    });
  });

  it('resetErrorLogState clears expectations and captures', () => {
    withCleanState(() => {
      expectErrorLog(/keep/);
      recordInProcessLogLine(ERR('keep me'));
      recordInProcessLogLine(ERR('surprise'));
      expect(getCapturedErrorLogs()).toHaveLength(2);
      resetErrorLogState();
      expect(getCapturedErrorLogs()).toEqual([]);
      expect(takeUnexpectedErrorLines()).toEqual([]);
      // expectation cleared too: the previously-expected line now counts
      expect(recordInProcessLogLine(ERR('keep me'))).toBe(false);
    });
  });

  it('createMockLogger records calls by level and exposes filters', () => {
    const mock = createMockLogger();
    mock.logger.info('starting');
    mock.logger.error('kaboom', { id: 7 });
    mock.logger.warn('hmm');
    expect(mock.calls).toHaveLength(3);
    expect(mock.errors()).toHaveLength(1);
    expect(mock.errors()[0]).toMatchObject({ message: 'kaboom', args: [{ id: 7 }] });
    expect(mock.warns()).toHaveLength(1);
    expect(mock.logger.error).toHaveBeenCalledWith('kaboom', { id: 7 });
    mock.reset();
    expect(mock.calls).toHaveLength(0);
    expect(mock.logger.error).not.toHaveBeenCalled();
  });
});
