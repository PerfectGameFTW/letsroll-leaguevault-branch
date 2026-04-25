/**
 * Tests the `log.debug` PII-leak guard introduced in task #389.
 *
 * The guard (`scripts/check-log-debug-pii.ts`) walks every `.ts`
 * file under `server/` (excluding `*.test.ts` and `__tests__/`),
 * extracts each `log.debug(...)` / `logger.debug(...)` call
 * expression, and fails when its argument list contains forbidden
 * identifiers (`email`, `password`, `token`, `phone`, `address`,
 * `secret`) without routing the value through a `mask*` helper or
 * carrying an inline `pii-lint-ok: …` annotation.
 *
 * These tests:
 *   1. Run the real script against the real codebase in `--strict`
 *      mode and assert exit 0. This is the actual CI forcing
 *      function — `package.json` is locked so we cannot add an
 *      `npm run check:log-debug-pii` shortcut, and vitest already
 *      runs in CI.
 *   2. Drive the script against synthetic fixtures via spawnSync to
 *      pin down its detection logic for: each forbidden token,
 *      `mask*` exemption, inline-annotation suppression, multi-line
 *      calls, template-literal interpolations, calls that span a
 *      block-comment, ignored test files, and that `info`/`warn`
 *      calls are out of scope.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts/check-log-debug-pii.ts');

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

function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'log-debug-pii-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

describe('check-log-debug-pii CI guard', () => {
  /**
   * The real CI forcing function. Adding a new `log.debug` line
   * with `email=${user.email}` (etc.) anywhere under `server/`
   * fails this assertion.
   */
  it('runs against the real codebase in --strict mode and exits 0', () => {
    const r = runIn(process.cwd(), ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/log\.debug PII guard: scanned \d+ file\(s\)/);
    expect(r.stdout).toMatch(/OK: no suspicious payloads detected/);
  });

  it.each([
    ['email', 'log.debug(`hi ${user.email}`);'],
    ['password', 'log.debug(`pw=${plaintextPassword}`);'],
    ['token', 'log.debug(`token=${resetToken}`);'],
    ['phone', 'log.debug(`phone=${user.phone}`);'],
    ['address', 'log.debug(`addr=${user.address}`);'],
    ['secret', 'log.debug(`shared secret: ${s}`);'],
  ])('flags %s in a log.debug payload', (kw, callExpr) => {
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';\nfunction f() {\n  ${callExpr}\n}\n`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`contains.*${kw}`));
  });

  it('also flags logger.debug (not just log.debug)', () => {
    const dir = makeFixture({
      'server/foo.ts': `import { logger } from './logger.js';
logger.debug(\`user email is \${u.email}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/contains.*email/);
  });

  it('exempts a call that routes the value through a mask* helper', () => {
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
import { maskEmail } from './pii.js';
log.debug(\`user email: \${maskEmail(u.email)}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('does NOT exempt look-alike helpers like unmaskedEmail()', () => {
    // The exemption only triggers on `mask` followed by an uppercase
    // letter, so `unmaskedEmail`, `unmask`, etc. don't sneak past.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug(\`user email: \${unmaskedEmail(u.email)}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/contains.*email/);
  });

  it('honors a /* pii-lint-ok: … */ inline annotation on the same line', () => {
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug(\`address keys: \${Object.keys(addr)}\`); /* pii-lint-ok: keys only */
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('honors a pii-lint-ok comment placed inside the call expression', () => {
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug(
  // pii-lint-ok: structural keys only, never values
  \`address fields: \${Object.keys(addr)}\`,
);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('handles multi-line log.debug calls with template-literal interpolation', () => {
    // The detector must paren-balance across newlines, template
    // strings, and nested ${...} expressions — otherwise it would
    // truncate the argument list and miss the forbidden keyword.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug(
  \`Multi-line debug:
   userEmail=\${user.email}
   userId=\${user.id}\`,
  { extra: { phone: user.phone } },
);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/email/);
    expect(r.stderr).toMatch(/phone/);
  });

  it('handles parens inside string literals without unbalancing the scanner', () => {
    // Mismatched parens inside a string would have unbalanced a
    // naive paren counter and made the scanner read past the end of
    // the call — proving the literal-aware paren matcher works.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug(\`status (auth) ok for user (id=\${user.id}) email=\${user.email}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/email/);
  });

  it('does not flag log.info or log.warn (out of scope — those go through different review)', () => {
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.info(\`user email \${u.email}\`);
log.warn(\`user phone \${u.phone}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('skips *.test.ts files', () => {
    const dir = makeFixture({
      'server/foo.test.ts': `import { log } from './logger.js';
log.debug(\`test only \${user.email}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('skips files under __tests__ directories', () => {
    const dir = makeFixture({
      'server/__tests__/fixture.ts': `import { log } from './logger.js';
log.debug(\`test only \${user.email}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('does not flag call sites with only safe payloads (numeric ids, role strings)', () => {
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug(\`bowler \${bowlerId} via league \${league.id} role=\${req.user.role}\`);
log.debug('Read port status:', { status, port: 5000 });
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('exits 0 in advisory mode (no --strict) even when violations exist', () => {
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug(\`email=\${u.email}\`);
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARN.*email/);
  });

  it('does NOT honor pii-lint-ok when it appears inside a string payload (bypass guard)', () => {
    // Architect-flagged bypass: a naive `argList.includes('pii-lint-ok')`
    // would have let this slip past --strict. The classifier
    // separates code / strings / comments and the suppression check
    // only looks at comment text.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug('pii-lint-ok email=' + user.email);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/email/);
  });

  it('does NOT honor mask* when it appears inside a string payload, not a real call', () => {
    // Architect-flagged bypass: an unrelated message that mentions
    // `maskEmail` (e.g. an error string) should not exempt the call
    // from the leak check. Only a genuine `maskEmail(...)` call in
    // code counts.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug('maskEmail failed', user.email);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/email/);
  });

  it('does NOT honor mask* when it appears only inside a comment', () => {
    // `/* maskEmail */` is a comment, not a call expression — the
    // exemption must require an actual `maskX(` token in code.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug(/* maskEmail */ \`email=\${user.email}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/email/);
  });

  it('honors a real maskEmail(...) call inside a template-literal interpolation', () => {
    // Positive complement of the bypass tests above: a genuine
    // `maskEmail(user.email)` call inside `${...}` IS the right
    // pattern and must be exempt.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
import { maskEmail } from './pii.js';
log.debug(\`for \${maskEmail(user.email)}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('decodes \\uXXXX escapes so a code identifier like user.\\u0065mail still flags', () => {
    // Architect-flagged Unicode bypass: TS allows Unicode escapes
    // inside identifiers, so a leak like `user.\\u0065mail` would
    // bypass a naive substring scan that only looked for the literal
    // word "email". The classifier decodes \\uXXXX before matching.
    const dir = makeFixture({
      'server/foo.ts':
        "import { log } from './logger.js';\n" +
        'log.debug(`leaked=${user.\\u0065mail}`);\n',
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/email/);
  });

  it('matches optional-chaining call shape `log?.debug(...)`', () => {
    const dir = makeFixture({
      'server/foo.ts':
        "import { log } from './logger.js';\n" +
        'log?.debug(`pw=${user.password}`);\n',
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/password/);
  });

  it("matches bracket-notation call shape `log['debug'](...)`", () => {
    const dir = makeFixture({
      'server/foo.ts':
        "import { log } from './logger.js';\n" +
        "log['debug']('email=' + user.email);\n",
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/email/);
  });

  it('decodes \\xHH escapes inside string literals (hex bypass)', () => {
    const dir = makeFixture({
      'server/foo.ts':
        "import { log } from './logger.js';\n" +
        "log.debug('\\x74\\x6f\\x6b\\x65\\x6e=' + s);\n",
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/token/);
  });

  it('decodes backslash-u-brace escapes inside string literals (the longer-form bypass)', () => {
    const dir = makeFixture({
      'server/foo.ts':
        "import { log } from './logger.js';\n" +
        "log.debug('\\u{74}\\u{6F}\\u{6B}\\u{65}\\u{6E}=' + resetValue);\n",
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/token/);
  });

  it('does not match log.debug inside a comment or block string', () => {
    // A `log.debug(...)` example inside a JSDoc / line comment is
    // documentation, not a real call site, and must not be flagged.
    // The scanner uses `commentRanges` to skip matches whose
    // position falls inside a `// ...` or `/* ... */` region.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
/**
 * Example: log.debug(\`email=\${u.email}\`); // never do this
 */
// also ok: log.debug('password=' + p);
log.debug(\`bowler=\${bowlerId}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('still flags a real log.debug call that follows a commented example', () => {
    // Defensive check: comment-skipping must not accidentally bleed
    // past the comment region and silence a real follow-up call.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
// Example: log.debug(\`email=\${u.email}\`);
log.debug(\`leak=\${user.email}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/email/);
  });

  it('treats `//` inside a string as part of the string, not a comment', () => {
    // `commentRanges` must not start a "comment" inside a string
    // literal — otherwise `'http://x'` could swallow real code that
    // follows on the same line.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
const url = 'http://example.com';
log.debug('email=' + user.email + ' url=' + url);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/email/);
  });

  // ---------------------------------------------------------------
  // Task #405 — AST upgrade: per-argument and aliased detection.
  // The old regex scanner would have let the leaks below slip past
  // because (a) any `mask*` call exempted the WHOLE call, and
  // (b) it never saw debug calls reached through an alias or
  // destructured binding.
  // ---------------------------------------------------------------

  it('per-argument: a mask* call on one argument does NOT exempt sibling arguments', () => {
    // Pre-AST behavior would have exempted the whole call because
    // `maskEmail(...)` appears anywhere in it. The AST scanner only
    // exempts the subtree rooted at the mask call, so the sibling
    // argument that leaks `phone` is still flagged.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
import { maskEmail } from './pii.js';
log.debug(\`for \${maskEmail(user.email)}\`, { phone: u.phone });
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/contains phone/);
    // And the masked email must NOT appear as a separate leak. The
    // word "email" still appears in the printed source line (the
    // `maskEmail(...)` call), so we assert specifically on the
    // "contains <kw>" verdict line, which is the scanner's only
    // claim about what is actually leaking.
    expect(r.stderr).not.toMatch(/contains email/);
  });

  it('per-argument: a mask* call on one object field does NOT exempt sibling fields', () => {
    // Same per-argument rule, this time inside a single object
    // literal argument. The mask exemption is scoped to one
    // property's value, not the whole object.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
import { maskEmail } from './pii.js';
log.debug({ masked: maskEmail(u.email), rawPhone: u.phone });
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/phone/);
  });

  it('detects aliased debug calls reached through `const d = log.debug`', () => {
    // The pre-AST regex `(log|logger)\.debug` never matched the
    // aliased call site. The AST scanner walks variable declarations
    // and treats identifiers bound to `log.debug` / `logger.debug`
    // as debug calls.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
const d = log.debug;
d(\`leaked=\${user.email}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/email/);
  });

  it('detects aliased debug calls reached through `const d = logger.debug`', () => {
    const dir = makeFixture({
      'server/foo.ts': `import { logger } from './logger.js';
const d = logger.debug;
d(\`pw=\${user.password}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/password/);
  });

  it('detects aliased debug calls reached through `const d = log["debug"]`', () => {
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
const d = log["debug"];
d(\`token=\${resetToken}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/token/);
  });

  it('detects destructured debug calls (`const { debug } = log`)', () => {
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
const { debug } = log;
debug(\`pw=\${user.password}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/password/);
  });

  it('detects renamed destructured debug calls (`const { debug: dd } = logger`)', () => {
    const dir = makeFixture({
      'server/foo.ts': `import { logger } from './logger.js';
const { debug: dd } = logger;
dd(\`addr=\${user.address}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/address/);
  });

  it('does NOT misclassify an unrelated identifier as a debug alias', () => {
    // A bare `debug` identifier that wasn't bound to `log.debug` /
    // `logger.debug` must not become a false positive — so an
    // imported `debug` from the npm `debug` package, or a local
    // function, can leak only if the AST actually identifies it as
    // a debug-of-our-logger call. Here the variable is bound to a
    // different function, and the call below must NOT be flagged.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
const debug = (msg: string) => msg;
debug(\`leaked email=\${user.email}\`);
log.debug('safe', { id: 1 });
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('still exempts a call that routes through a mask* helper (per-arg, value-only)', () => {
    // Positive complement of the per-arg tests: when the only PII
    // surface is the value going through the mask call AND the
    // surrounding text doesn't independently mention a forbidden
    // word, the call is exempt.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
import { maskEmail } from './pii.js';
log.debug('user', { id: 1, masked: maskEmail(u.email) });
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it('rejects a pii-lint-ok annotation with NO reason after the colon', () => {
    // Auditability requirement: the suppression tag MUST carry a
    // non-empty reason so reviewers can verify the rationale.
    // `// pii-lint-ok:` (empty) and bare `pii-lint-ok` (no colon)
    // do not suppress.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug(\`pw=\${user.password}\`); // pii-lint-ok:
log.debug(\`pw=\${user.password}\`); // pii-lint-ok
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    // Two distinct violations should be reported.
    const fails = r.stderr.match(/FAIL:.*password/g) ?? [];
    expect(fails.length).toBe(2);
  });

  it('documents the masked-template tradeoff: head/middle/tail label text is NOT scanned when the template contains a mask call', () => {
    // Tradeoff doc + regression pin. When a template literal has at
    // least one `mask*(...)` interpolation, the scanner stops
    // scanning the literal head/middle/tail segments to avoid
    // false-positives on captioned messages like
    // `` `user email: ${maskEmail(u.email)}` ``. The cost is that
    // a contrived case where the forbidden token only appears in
    // the literal label AND the sibling interpolation expression
    // happens to be a neutral identifier (`s`, `x`, `value`) is
    // not flagged when a mask call is also present in the template.
    // The two key calls live on lines 4 and 5 of the fixture below;
    // line 4 is intentionally NOT flagged (the documented tradeoff)
    // while the analogous template WITHOUT a mask call (line 5) IS
    // flagged. The real-leak case where the sibling expression
    // names a forbidden field (`user.password`) is still caught
    // and is covered by the per-argument test above.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
import { maskEmail } from './pii.js';
const s = 'sentinel';
log.debug(\`shared secret: \${s}, also \${maskEmail(u.email)}\`);
log.debug(\`shared secret: \${s}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    // Only one violation: line 5 (no mask call in the template).
    const fails = r.stderr.match(/FAIL:.*secret/g) ?? [];
    expect(fails.length).toBe(1);
    expect(r.stderr).toMatch(/foo\.ts:5/);
    expect(r.stderr).not.toMatch(/foo\.ts:4/);
  });

  it('detects a `var` debug alias hoisted to the enclosing function scope', () => {
    // `var` hoists to the nearest function scope, not the block.
    // A `var d = log.debug` inside a block must therefore be
    // visible to a `d(...)` call OUTSIDE that block but inside the
    // same function. Without function-scope hoisting handling, this
    // bypass would slip past the alias resolver.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
function withVar() {
  if (true) {
    var d = log.debug;
  }
  d(\`var-leak email=\${user.email}\`);
}
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/contains email/);
  });

  it('detects an assignment-alias debug call (`d = log.debug; d(...)`)', () => {
    // Aliases can be bound by a plain assignment to a previously-
    // declared (or globally-declared) name, not just by an
    // initializer in a const/let/var declaration. The scanner
    // recognizes the assignment expression as an alias source.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
function withAssign() {
  let d2: any;
  d2 = log.debug;
  d2(\`assign-leak phone=\${user.phone}\`);
}
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/contains phone/);
  });

  it('resolves an assignment-alias to the declaring scope (cross-block)', () => {
    // Pin the cross-block assignment-alias case. The variable `d`
    // is declared at function scope but the alias-binding
    // assignment happens inside a nested block. A naive
    // implementation that records the alias only against the
    // assignment's own block scope would miss the call placed
    // outside that block — a real bypass. The resolver must walk
    // up to the declaration scope and record the alias there so
    // sibling statements in the same function still see it.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
function crossBlock(cond: boolean, user: any) {
  let d: any;
  if (cond) {
    d = log.debug;
  }
  d({ email: user.email });
}
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/contains email/);
  });

  it('alias resolution is scope-aware: an inner shadowing binding hides the outer alias', () => {
    // Pin the scope-aware alias resolver. An outer `const d =
    // log.debug` is a real debug alias, but inner functions that
    // re-bind `d` (as a parameter, an inner const, a catch
    // variable, or a function declaration) MUST shadow the alias
    // so the inner `d(...)` is not falsely treated as a debug call.
    // Without scope-aware resolution this file would produce three
    // false positives (lines 7, 11, 14); with it, only line 4 (the
    // genuine leaky call through the outer alias) is flagged.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
const d = log.debug;
function leaky() {
  d(\`leaked email=\${user.email}\`);
}
function shadowedParam(d: (m: string) => void) {
  d(\`unrelated email=\${user.email}\`);
}
function shadowedConst() {
  const d = (m: string) => m;
  d(\`unrelated email=\${user.email}\`);
}
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    const fails = r.stderr.match(/FAIL:.*email/g) ?? [];
    expect(fails.length).toBe(1);
    expect(r.stderr).toMatch(/foo\.ts:4/);
    expect(r.stderr).not.toMatch(/foo\.ts:7/);
    expect(r.stderr).not.toMatch(/foo\.ts:11/);
  });

  it('rejects an EMPTY block-comment pii-lint-ok with no reason between `:` and `*/`', () => {
    // The auditability requirement also has to hold for block
    // comments. A bare `/* pii-lint-ok: */` looks like it has a
    // non-empty body to a naive `\\S` check (the `*` of the closing
    // `*/` is non-whitespace), so the suppressor must explicitly
    // strip the block-comment terminator before verifying that a
    // real reason is present.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
log.debug(\`pw=\${user.password}\`); /* pii-lint-ok: */
log.debug(\`pw=\${user.password}\`); /* pii-lint-ok:    */
`,
    });
    const r = runIn(dir, ['--strict']);
    expect(r.status).toBe(1);
    const fails = r.stderr.match(/FAIL:.*password/g) ?? [];
    expect(fails.length).toBe(2);
  });
});
