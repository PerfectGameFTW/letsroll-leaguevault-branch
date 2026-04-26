/**
 * Repo-wide drift guard for the `PaymentSyncStatus` four-state union
 * (task #490, locking in the contract established by task #374).
 *
 * Why: task #374 lifted `type PaymentSyncStatus = ...` out of the
 * scattered local declarations and into the single canonical home at
 * `shared/schema/bowlers.ts`, alongside the runtime `parsePaymentSyncStatus`
 * helper. That lets client, server, and tests narrow against the
 * SAME authoritative list — a precondition for safely adding a fifth
 * state (or renaming one) without leaving stale stringly-typed code
 * behind. Nothing structural prevents a future PR from re-introducing
 * a local `type PaymentSyncStatus = ...` or a hand-rolled
 * `'synced' | 'skipped' | 'pending_retry' | 'not_applicable'` union
 * elsewhere in the repo, silently recreating the drift problem.
 *
 * This test fails when:
 *   1. Any file outside `shared/` declares a top-level
 *      `type PaymentSyncStatus = ...` (or `export type PaymentSyncStatus = ...`).
 *   2. Any file outside `shared/` writes the four canonical state
 *      strings as a hand-rolled union of string literals separated
 *      by `|`, in any order. The `PAYMENT_SYNC_STATUSES` array form
 *      (commas, not pipes) is intentionally NOT matched — that's the
 *      one place the four strings legitimately live in source.
 *
 * Allowed exceptions are listed in `ALLOWED_FILES`. Each must be
 * justified inline.
 *
 * Remediation when this test fails: import `PaymentSyncStatus` (and,
 * for runtime narrowing, `parsePaymentSyncStatus`) from
 * `@shared/schema` instead of declaring locally.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

// Directory basenames that the scan never descends into. `shared/`
// is excluded because it IS the canonical home (see
// shared/schema/bowlers.ts). Build/vendor/asset directories are
// excluded for performance.
const SKIP_DIRS = new Set<string>([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.cache',
  '.local',
  '.next',
  'coverage',
  'attached_assets',
  'migrations',
  'public',
  'shared',
]);

// File extensions that are scanned. `.d.ts` is included because a
// future ambient declaration could re-introduce drift just as easily
// as a regular .ts file.
const SCAN_EXTS = new Set<string>(['.ts', '.tsx', '.cts', '.mts']);

// Documented exceptions, expressed as POSIX-relative paths from ROOT.
// Both entries are intentional and audited; do NOT add new entries
// without a real reason and a justifying comment.
const ALLOWED_FILES = new Set<string>([
  // server/services/payment-customer-sync.ts re-exports
  // `PaymentSyncStatus` from @shared/schema so the long-standing
  // `import { PaymentSyncStatus } from '.../payment-customer-sync'`
  // call sites in the payment-sync service code keep working without
  // a fan-out edit. The re-export uses `export type { PaymentSyncStatus }`
  // (no `=`), so it would not match the alias-declaration regex
  // anyway — listed here for documentation only.
  'server/services/payment-customer-sync.ts',
  // This file itself contains the literal patterns it scans for
  // (in regex sources and remediation prose), so it would
  // self-flag the union check otherwise.
  'tests/unit/check-no-payment-sync-status-drift.test.ts',
]);

// Matches a top-level type alias declaration at the start of a line:
//   type PaymentSyncStatus = ...
//   export type PaymentSyncStatus = ...
// Crucially does NOT match imports/re-exports like
//   import type { PaymentSyncStatus } from ...
//   export type { PaymentSyncStatus } from ...
// because those have no `=` after the identifier.
const TYPE_ALIAS_RE = /^[ \t]*(?:export\s+)?type\s+PaymentSyncStatus\s*=/m;

// Matches four quoted string literals separated by `|`. Each literal
// must be one of the canonical PaymentSyncStatus values, and the
// post-match step requires all four DISTINCT values to appear (so a
// pathological `'synced' | 'synced' | 'synced' | 'synced'` will not
// trigger the guard). Single OR double quotes are accepted.
const UNION_RE =
  /(?:['"](?:synced|skipped|pending_retry|not_applicable)['"]\s*\|\s*){3}['"](?:synced|skipped|pending_retry|not_applicable)['"]/g;

const CANONICAL_VALUES = [
  'synced',
  'skipped',
  'pending_retry',
  'not_applicable',
] as const;

function findHandRolledUnion(src: string): string[] {
  const hits: string[] = [];
  for (const m of src.matchAll(UNION_RE)) {
    const matched = m[0];
    const present = new Set<string>();
    for (const v of CANONICAL_VALUES) {
      if (matched.includes(`'${v}'`) || matched.includes(`"${v}"`)) {
        present.add(v);
      }
    }
    if (present.size === CANONICAL_VALUES.length) hits.push(matched);
  }
  return hits;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walk(full, out);
    } else if (s.isFile()) {
      const dot = full.lastIndexOf('.');
      if (dot < 0) continue;
      const ext = full.slice(dot);
      if (SCAN_EXTS.has(ext)) out.push(full);
    }
  }
  return out;
}

function relPosix(file: string): string {
  return relative(ROOT, file).split(sep).join('/');
}

describe('PaymentSyncStatus drift guard (#490)', () => {
  it('no file outside shared/ declares its own PaymentSyncStatus type alias or hand-rolls the four-state union', () => {
    const files = walk(ROOT);
    const aliasOffenders: string[] = [];
    const unionOffenders: { file: string; sample: string }[] = [];

    for (const file of files) {
      const rel = relPosix(file);
      if (ALLOWED_FILES.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      if (TYPE_ALIAS_RE.test(src)) {
        aliasOffenders.push(rel);
      }
      const unionHits = findHandRolledUnion(src);
      if (unionHits.length > 0) {
        unionOffenders.push({ file: rel, sample: unionHits[0] });
      }
    }

    const aliasMsg = aliasOffenders.length
      ? `\nFiles that locally declare \`type PaymentSyncStatus = ...\`:\n` +
        aliasOffenders.map((p) => `  - ${p}`).join('\n')
      : '';
    const unionMsg = unionOffenders.length
      ? `\nFiles that hand-roll the four-state union inline:\n` +
        unionOffenders
          .map((o) => `  - ${o.file}\n      sample: ${o.sample}`)
          .join('\n')
      : '';
    const remediation =
      aliasOffenders.length || unionOffenders.length
        ? `\n\nFix: import \`PaymentSyncStatus\` (and \`parsePaymentSyncStatus\` for runtime narrowing) from \`@shared/schema\`. ` +
          `If a documented re-export is genuinely needed, add the path to ALLOWED_FILES in this test with a justifying comment ` +
          `(see server/services/payment-customer-sync.ts for the existing precedent).`
        : '';

    expect(
      aliasOffenders.length + unionOffenders.length,
      `Found PaymentSyncStatus drift outside shared/ (task #490 / #374).${aliasMsg}${unionMsg}${remediation}`,
    ).toBe(0);
  });

  it('the canonical declaration in shared/schema/bowlers.ts is still present (anti-vacuous-pass guard)', () => {
    // Without this, a refactor that accidentally removed or renamed
    // the canonical alias would leave the negative scan above
    // trivially green — there'd be nothing left to drift FROM. Pin
    // the canonical declaration explicitly so a regression there
    // also lights up.
    const src = readFileSync(
      join(ROOT, 'shared/schema/bowlers.ts'),
      'utf8',
    );
    expect(
      TYPE_ALIAS_RE.test(src),
      'expected the canonical `type PaymentSyncStatus = ...` declaration to remain in shared/schema/bowlers.ts',
    ).toBe(true);
  });

  it('the documented re-export in server/services/payment-customer-sync.ts still re-exports PaymentSyncStatus and does not declare it locally', () => {
    // The single allowed non-shared/ reference is a re-export, not a
    // local definition. If it ever grows into a local declaration
    // (e.g. someone replaces the re-export with `type ... = ...`),
    // this test will fail and force an audit instead of silently
    // pretending the allowlist entry is still benign.
    const src = readFileSync(
      join(ROOT, 'server/services/payment-customer-sync.ts'),
      'utf8',
    );
    expect(
      /export\s+type\s+\{\s*PaymentSyncStatus\s*\}/.test(src),
      'expected `export type { PaymentSyncStatus }` re-export to remain in server/services/payment-customer-sync.ts',
    ).toBe(true);
    expect(
      TYPE_ALIAS_RE.test(src),
      'server/services/payment-customer-sync.ts must not also declare a local PaymentSyncStatus alias',
    ).toBe(false);
  });

  it('detection logic (positive control): a synthetic local alias would be flagged by TYPE_ALIAS_RE', () => {
    // Self-test of the regex so the negative scan above can't pass
    // because the regex is broken. Mirrors the spirit of the
    // anti-vacuous-pass guard for the canonical declaration.
    const offending =
      "// some file\nexport type PaymentSyncStatus = 'a' | 'b';\n";
    expect(TYPE_ALIAS_RE.test(offending)).toBe(true);

    const benign =
      "import { type PaymentSyncStatus } from '@shared/schema';\n" +
      "export type { PaymentSyncStatus } from './foo';\n";
    expect(TYPE_ALIAS_RE.test(benign)).toBe(false);
  });

  it('detection logic (positive control): a synthetic hand-rolled union would be flagged by findHandRolledUnion', () => {
    const offending =
      "type X = 'pending_retry' | 'synced' | 'skipped' | 'not_applicable';";
    expect(findHandRolledUnion(offending).length).toBe(1);

    // The array form (commas, not pipes) — used in the canonical
    // PAYMENT_SYNC_STATUSES tuple — must NOT match.
    const arrayForm =
      "const PAYMENT_SYNC_STATUSES = ['synced', 'skipped', 'pending_retry', 'not_applicable'] as const;";
    expect(findHandRolledUnion(arrayForm).length).toBe(0);

    // A degenerate "union of one repeated value" must NOT match.
    const repeated = "type X = 'synced' | 'synced' | 'synced' | 'synced';";
    expect(findHandRolledUnion(repeated).length).toBe(0);

    // A union of only THREE of the four values must NOT match — only
    // the full canonical four-tuple is the drift signal.
    const threeOnly =
      "type X = 'synced' | 'skipped' | 'pending_retry';";
    expect(findHandRolledUnion(threeOnly).length).toBe(0);
  });
});
