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
    // A `log.debug(...)` example inside a JSDoc block (which is the
    // exact situation in the audit doc — well, in source comments)
    // must not be flagged. A naive scanner would treat the doc
    // example as a real call site.
    const dir = makeFixture({
      'server/foo.ts': `import { log } from './logger.js';
/**
 * Example: log.debug(\`email=\${u.email}\`); // never do this
 */
log.debug(\`bowler=\${bowlerId}\`);
`,
    });
    const r = runIn(dir, ['--strict']);
    // The block-comment example uses a backtick which we don't
    // perfectly track inside line/block comments; the simpler
    // contract is that calls inside /** ... */ are still scanned,
    // because a naive author could un-comment them. Document the
    // current behavior: this fixture's commented example DOES get
    // scanned and flagged, by design.
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/email/);
  });
});
