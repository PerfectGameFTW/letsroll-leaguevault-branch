/**
 * Tests the ESLint suppression baseline guard introduced in task #385.
 *
 * The guard (`scripts/check-eslint-baseline.ts`) reads
 * `eslint-suppressions.json` and asserts the per-rule and total
 * suppression counts stay at or below ceilings declared at the top of
 * that script. Default mode prints a report and exits 0; `--strict`
 * exits 1 when any ceiling is breached.
 *
 * These tests:
 *   1. Run the real script against the real codebase in --strict
 *      mode — this is the actual CI forcing function. We can't add an
 *      `npm run check:eslint-baseline` shortcut (`package.json` is
 *      locked in this environment), so vitest — which already runs in
 *      CI — surfaces regressions instead. Adding a new
 *      `@typescript-eslint/no-explicit-any` suppression and
 *      regenerating the baseline pushes the live count above the
 *      ceiling, the script exits 1, and this test fails.
 *   2. Drive the script against synthetic fixtures via spawnSync to
 *      pin down its detection logic for: count exceeded, count below
 *      ceiling (ratchet suggestion), missing file, malformed JSON,
 *      multi-rule baselines, and advisory vs. strict mode.
 */
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  mkdtempSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts/check-eslint-baseline.ts');

function runIn(
  cwd: string,
  args: string[] = [],
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('npx', ['tsx', SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function makeFixture(suppressions: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'eslint-baseline-check-'));
  writeFileSync(
    join(dir, 'eslint-suppressions.json'),
    JSON.stringify(suppressions, null, 2),
  );
  return dir;
}

describe('check-eslint-baseline CI guard', () => {
  /**
   * The actual CI forcing function. Running --strict against the real
   * codebase MUST succeed. If a future PR adds new
   * `@typescript-eslint/no-explicit-any` suppressions and regenerates
   * `eslint-suppressions.json`, this test fails until either the
   * suppressions are removed or the ceiling is intentionally raised
   * in `scripts/check-eslint-baseline.ts`.
   */
  it('runs against the real codebase in --strict mode and exits 0', () => {
    const r = runIn(process.cwd(), ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(
      /eslint suppression baseline: scanned \d+ rule\(s\), \d+ total/,
    );
  });

  /**
   * Pin every ceiling declared in the script to the LIVE count so the
   * baseline is fully ratcheted. This is what makes the cleanup
   * monotonic: any drop in the real count without a matching ceiling
   * lowering surfaces as a RATCHET suggestion in the script's stdout.
   * If we don't enforce the equality, the ceiling drifts upward
   * silently after a future "remove an `any` then add a different
   * `any`" sequence.
   */
  it('keeps every ceiling tight against the live count (no slack to absorb new suppressions)', () => {
    const r = runIn(process.cwd(), ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).not.toMatch(/^RATCHET:/m);
  });

  it('exits 1 in --strict mode when a per-rule ceiling is exceeded', () => {
    // Construct a fixture with 258 no-non-null-assertion suppressions
    // in one file — above the ceiling of 250 baked into the script
    // (the original task-#371 ceiling of 232 was raised to 258 by
    // task #516 to absorb typed-debt fixes, then ratcheted down to
    // 256 in a later cleanup that removed two non-null assertions
    // from the payment hook, then ratcheted to 255 in task #646
    // when the dead `checkAndChargeFinalTwoWeeks` helper was deleted,
    // then to 250 in a follow-up cleanup pass).
    // We pick this rule rather than no-explicit-any because the
    // latter is ratcheted to 0, leaving no slack to write a "exceeds
    // the ceiling" fixture without also tripping every other check
    // at the same time.
    const dir = makeFixture({
      'src/foo.ts': {
        '@typescript-eslint/no-non-null-assertion': { count: 258 },
      },
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAIL: @typescript-eslint\/no-non-null-assertion/);
    expect(r.stderr).toMatch(/258 suppressions \(ceiling 249\)/);
  });

  it('exits 1 in --strict mode when the total ceiling is exceeded (catches "swap one any for a different rule" workarounds)', () => {
    // Each ratcheted rule pinned at its current ceiling (so no
    // per-rule breach fires) + an unrelated rule pushing the total
    // past the 527 cap (originally 472, raised by task #516 alongside
    // the per-rule bumps, then ratcheted to 533 alongside the
    // no-non-null-assertion drop from 258 → 256, then ratcheted to
    // 527 in task #572 alongside the apple-pay-jobs `find(...)!`
    // cleanup and matching no-unnecessary-type-assertion +
    // no-restricted-syntax drops). The unrelated rule
    // (`no-unused-vars`) is not in RULE_CEILINGS, so this fixture
    // isolates the total-ceiling check from the per-rule check.
    // Pinned-rule sum = 0 + 255 + 88 + 4 + 153 = 500; +100 unrelated
    // = 600 total, which is 78 over the 522 ceiling.
    const dir = makeFixture({
      'src/foo.ts': {
        '@typescript-eslint/no-explicit-any': { count: 0 },
        '@typescript-eslint/no-non-null-assertion': { count: 255 },
        '@typescript-eslint/no-unnecessary-type-assertion': { count: 88 },
        '@typescript-eslint/consistent-type-assertions': { count: 4 },
        'no-restricted-syntax': { count: 153 },
        '@typescript-eslint/no-unused-vars': { count: 100 },
      },
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAIL: total suppressions: 600/);
  });

  it('exits 0 with a RATCHET hint when a per-rule count drops below the ceiling', () => {
    // 100 suppressions for the rule whose ceiling is 250 → ratchet
    // suggestion expected. Total is 100, below the total ceiling of
    // 517 → another ratchet line.
    const dir = makeFixture({
      'src/foo.ts': {
        '@typescript-eslint/no-non-null-assertion': { count: 100 },
      },
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(
      /RATCHET: @typescript-eslint\/no-non-null-assertion: 100 suppressions \(ceiling 249\)/,
    );
    expect(r.stdout).toMatch(/Lower RULE_CEILINGS/);
    expect(r.stdout).toMatch(/RATCHET: total suppressions: 100/);
  });

  it('exits 0 in advisory mode (no --strict) even when ceilings are exceeded', () => {
    const dir = makeFixture({
      'src/foo.ts': {
        '@typescript-eslint/no-explicit-any': { count: 99 },
      },
    });
    const r = runIn(dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARN: @typescript-eslint\/no-explicit-any/);
  });

  it('treats a missing eslint-suppressions.json as zero suppressions (clean repo)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eslint-baseline-empty-'));
    const r = runIn(dir, ['--strict']);
    // Missing file → all counts are 0 → every ceiling is "above"
    // live, so we get RATCHET suggestions but exit 0.
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/RATCHET:/);
  });

  it('fails loudly on a malformed eslint-suppressions.json instead of silently passing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eslint-baseline-bad-'));
    writeFileSync(join(dir, 'eslint-suppressions.json'), '{ not valid json');
    const r = runIn(dir, ['--strict']);
    // tsx propagates the thrown Error → non-zero exit and the
    // failure message lands on stderr, so a corrupted baseline can't
    // sneak through CI as "0 suppressions, all good".
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Failed to parse/);
  });

  it.each([
    ['string count', { count: '5' }],
    ['negative count', { count: -3 }],
    ['NaN count', { count: Number.NaN }],
    ['fractional count', { count: 1.5 }],
    ['null count', { count: null }],
    ['missing count', {}],
  ])(
    'fails loudly on a %s instead of silently coercing to 0/NaN and passing the gate',
    (_label, info) => {
      // The previous lax parser used `info.count ?? 0` and arithmetic
      // on the result, so a corrupted entry could make every ceiling
      // check evaluate false (NaN comparisons return false in both
      // directions) and let suppression growth slip through CI.
      const dir = makeFixture({
        'src/foo.ts': {
          '@typescript-eslint/no-explicit-any': info,
        },
      });
      const r = runIn(dir, ['--strict']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/Invalid count/);
    },
  );

  it('does not flag rules that are not in the ceilings map (out of scope)', () => {
    // 5 suppressions for a rule with no declared ceiling alongside a
    // ratcheted rule pinned at its ceiling — should contribute to
    // the total (well below 467) but not produce a per-rule failure.
    const dir = makeFixture({
      'src/foo.ts': {
        '@typescript-eslint/some-other-rule': { count: 5 },
        '@typescript-eslint/no-non-null-assertion': { count: 228 },
      },
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stderr).not.toMatch(/some-other-rule/);
  });

  it('asserts the script header documents how operators ratchet the ceiling', () => {
    // Belt-and-braces: the script's own usage instructions (which
    // are what new contributors read when this test fails) must
    // mention both modes and the ratchet workflow.
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/--strict/);
    expect(src).toMatch(/RATCHET/);
    expect(src).toMatch(/RULE_CEILINGS/);
  });
});
