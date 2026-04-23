/**
 * ESLint suppression baseline guard (task #385).
 *
 * Tasks #329 and #384 drove the count of `@typescript-eslint/no-explicit-any`
 * suppressions in `eslint-suppressions.json` from 161 down to a small
 * single-digit number. Without a forcing function, the next PR can
 * silently grow the count again by adding new `any` annotations and
 * regenerating the baseline.
 *
 * This script reads `eslint-suppressions.json` and compares the live
 * counts against the ceilings declared below. By default it prints a
 * report and exits 0 (advisory). Pass `--strict` to exit 1 when any
 * ceiling is breached — that is how the vitest forcing function in
 * `tests/unit/check-eslint-baseline.test.ts` enforces the ratchet in
 * CI (we cannot add an `npm run check:eslint-baseline` script because
 * `package.json` is locked in this environment).
 *
 * Ratcheting the ceiling
 * ----------------------
 * When the live count drops below a ceiling, this script (in any mode)
 * emits a "RATCHET" suggestion line so the next contributor remembers
 * to lower the ceiling in the same PR. The ceiling lives at the top of
 * this file as a single literal block so reviewers see the change in
 * the diff.
 *
 * Run with:
 *   tsx scripts/check-eslint-baseline.ts            # advisory
 *   tsx scripts/check-eslint-baseline.ts --strict   # CI gate
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Map of `eslint-suppressions.json` rule name → maximum allowed count
// across the whole codebase. To add a new ratcheted rule, add it here
// (and only here) — the script will start enforcing it on the next run.
//
// Lower these as the live count drops; never raise them without an
// explicit, reviewed reason in the same PR.
const RULE_CEILINGS: Record<string, number> = {
  '@typescript-eslint/no-explicit-any': 4,
};

// Ceiling for the sum of all suppression counts across every rule.
// Catches "I added a different lint suppression instead" workarounds.
// As of task #385 the file contains 26 total suppressions.
const TOTAL_CEILING = 26;

const STRICT = process.argv.includes('--strict');
const SUPPRESSIONS_PATH = resolve(process.cwd(), 'eslint-suppressions.json');

interface SuppressionsFile {
  [filePath: string]: {
    [rule: string]: { count: number };
  };
}

function loadCounts(path: string): {
  byRule: Map<string, number>;
  total: number;
} {
  if (!existsSync(path)) {
    return { byRule: new Map(), total: 0 };
  }
  const raw = readFileSync(path, 'utf8');
  let json: SuppressionsFile;
  try {
    json = JSON.parse(raw) as SuppressionsFile;
  } catch (err) {
    throw new Error(
      `Failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const byRule = new Map<string, number>();
  let total = 0;
  for (const [filePath, fileEntry] of Object.entries(json)) {
    if (!fileEntry || typeof fileEntry !== 'object') continue;
    for (const [rule, info] of Object.entries(fileEntry)) {
      const rawCount = (info as { count?: unknown } | null)?.count;
      // Reject anything that isn't a finite, non-negative integer.
      // Without this, a corrupted entry like `{"count": "5"}` or
      // `{"count": NaN}` would silently coerce to 0 / NaN and let
      // suppression growth slip past both ceiling checks.
      if (
        typeof rawCount !== 'number' ||
        !Number.isFinite(rawCount) ||
        !Number.isInteger(rawCount) ||
        rawCount < 0
      ) {
        throw new Error(
          `Invalid count in ${path} at ${filePath} → ${rule}: ${JSON.stringify(rawCount)} (expected non-negative integer)`,
        );
      }
      byRule.set(rule, (byRule.get(rule) ?? 0) + rawCount);
      total += rawCount;
    }
  }
  return { byRule, total };
}

function main(): number {
  const { byRule, total } = loadCounts(SUPPRESSIONS_PATH);

  const breaches: string[] = [];
  const ratchets: string[] = [];

  for (const [rule, ceiling] of Object.entries(RULE_CEILINGS)) {
    const live = byRule.get(rule) ?? 0;
    if (live > ceiling) {
      breaches.push(
        `${rule}: ${live} suppressions (ceiling ${ceiling}). ` +
          `Remove the new suppression(s) instead of regenerating the baseline.`,
      );
    } else if (live < ceiling) {
      ratchets.push(
        `${rule}: ${live} suppressions (ceiling ${ceiling}). ` +
          `Lower RULE_CEILINGS['${rule}'] in scripts/check-eslint-baseline.ts to ${live}.`,
      );
    }
  }

  if (total > TOTAL_CEILING) {
    breaches.push(
      `total suppressions: ${total} (ceiling ${TOTAL_CEILING}). ` +
        `Remove the new suppression(s) instead of regenerating the baseline.`,
    );
  } else if (total < TOTAL_CEILING) {
    ratchets.push(
      `total suppressions: ${total} (ceiling ${TOTAL_CEILING}). ` +
        `Lower TOTAL_CEILING in scripts/check-eslint-baseline.ts to ${total}.`,
    );
  }

  // Always print a summary so reviewers and CI logs have context.
  process.stdout.write(
    `eslint suppression baseline: scanned ${byRule.size} rule(s), ${total} total suppression(s)\n`,
  );
  for (const [rule, ceiling] of Object.entries(RULE_CEILINGS)) {
    process.stdout.write(
      `  ${rule}: ${byRule.get(rule) ?? 0} / ${ceiling}\n`,
    );
  }
  process.stdout.write(`  total: ${total} / ${TOTAL_CEILING}\n`);

  for (const r of ratchets) {
    process.stdout.write(`RATCHET: ${r}\n`);
  }

  if (breaches.length > 0) {
    const banner = STRICT ? 'FAIL' : 'WARN';
    for (const b of breaches) {
      process.stderr.write(`${banner}: ${b}\n`);
    }
    if (STRICT) {
      process.stderr.write(
        `\nThe ESLint suppression baseline grew. Either remove the new ` +
          `suppression(s) by typing the offending code, or — with reviewer ` +
          `sign-off — raise the ceiling in scripts/check-eslint-baseline.ts.\n`,
      );
      return 1;
    }
  } else {
    process.stdout.write('OK: no ceilings exceeded\n');
  }
  return 0;
}

const code = main();
process.exit(code);
