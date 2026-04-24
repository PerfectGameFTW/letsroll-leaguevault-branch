/**
 * Shared assertion helper for the "no token material in logs" contract
 * (task #307 + #396). Used by every regression test that mocks the
 * logger, drives a reject branch with known secret bytes, and pins
 * that none of those secret bytes (or a useful prefix of them) ever
 * appear in a captured log line.
 *
 * The per-test boilerplate that wires `vi.mock('../../server/logger')`
 * is intentionally NOT in this file — vitest hoists `vi.mock` above
 * top-level `const` declarations, which would put any factored-out
 * `record(...)` capture closure in the temporal dead zone at the
 * moment the mocked module is first imported. Each test file keeps
 * its own `function record(level)` declaration (which IS hoisted) and
 * delegates the regex / 8-byte-prefix check to `assertNoTokenLeak`
 * here so the contract is enforced in exactly one place.
 *
 * See:
 *   - `docs/security/no-secrets-in-logs.md` — audit + per-surface map
 *   - `tests/unit/csrf-no-token-leak.test.ts` — original template
 */
import { expect } from 'vitest';

export interface CapturedLogLine {
  level: string;
  line: string;
}

export interface NoLeakSecrets {
  /**
   * Every full secret value that must not appear, anywhere, in any
   * captured log line. Each value is also checked at a prefix length
   * (default 8) so a sloppy `token.slice(0, 16)` log call is caught.
   */
  full: string[];
  /**
   * Optional shorter byte sequences (e.g. a known masked tail) that
   * must not appear as a literal substring. No prefix check is run on
   * these because they may already be shorter than `prefixLength`.
   */
  partials?: string[];
  /**
   * Smallest contiguous prefix of any `full` secret that we treat as
   * a leak. Defaults to 8 — short enough to catch substring logging
   * shapes a future code change might introduce, long enough that an
   * unrelated short identifier with the same alphabet doesn't false-
   * positive.
   */
  prefixLength?: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function assertNoTokenLeak(
  captured: ReadonlyArray<CapturedLogLine>,
  secrets: NoLeakSecrets,
): void {
  const prefixLength = secrets.prefixLength ?? 8;
  for (const { line } of captured) {
    for (const s of secrets.full) {
      expect(line).not.toContain(s);
      if (s.length >= prefixLength) {
        expect(line).not.toMatch(
          new RegExp(escapeRegex(s.slice(0, prefixLength))),
        );
      }
    }
    for (const p of secrets.partials ?? []) {
      expect(line).not.toContain(p);
    }
  }
}
