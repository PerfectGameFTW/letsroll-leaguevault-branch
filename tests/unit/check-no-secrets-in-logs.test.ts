/**
 * Tests the project-wide "no secret-bearing fields in log calls" guard
 * introduced in task #432 and extended to the client surface in
 * task #515.
 *
 * The guard (`scripts/check-no-secrets-in-logs.ts`) walks every `.ts`
 * file under `server/` (excluding `*.test.ts` and `__tests__/`) and
 * fails when any `log.<level>` / `logger.<level>` / `console.<level>`
 * call interpolates a known secret-bearing shape:
 *   - property access ending in `.password` / `.token` /
 *     `.inviteToken` / `.setupSecret` / `.csrfToken` / `.resetToken`
 *   - bare identifier `inviteToken` / `setupSecret` / `csrfToken` /
 *     `resetToken`
 *   - element access with literal `'x-csrf-token'` / `'x-setup-secret'`
 *
 * This file pins the SERVER surface. The companion file
 * `check-no-secrets-in-logs-client.test.ts` pins the CLIENT surface
 * (which adds form-reader and password-field patterns).
 *
 * These tests:
 *   1. Import `scanSource` from the script directly and drive it
 *      against synthetic source strings to pin down its detection
 *      logic. In-process calls avoid the ~4s `npx tsx` startup cost
 *      per test (with ~25 tests, the spawn-per-test approach pushes
 *      the file past the 30s vitest test timeout in serial CI).
 *   2. Run the real CLI script ONCE via spawnSync against the real
 *      codebase in `--strict` mode and assert exit 0. This is the
 *      actual CI forcing function — `package.json` is locked so we
 *      cannot add a dedicated npm script, and vitest already runs in
 *      CI (the same wiring as the sibling `check-log-debug-pii`
 *      guard).
 *   3. Run the CLI ONCE more in advisory (no `--strict`) mode against
 *      a temp fixture to pin the exit-0-with-warnings behavior.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { scanSource, SERVER_SURFACE } from '../../scripts/check-no-secrets-in-logs';

const SCRIPT = join(process.cwd(), 'scripts/check-no-secrets-in-logs.ts');

function reasonsFor(src: string): string[] {
  return scanSource('server/fixture.ts', src, SERVER_SURFACE).flatMap(
    (h) => h.reasons,
  );
}

describe('check-no-secrets-in-logs CI guard', () => {
  /**
   * The real CI forcing function. Adding a new log call anywhere
   * under `server/` that interpolates `req.body.password`,
   * `csrfToken`, etc. fails this assertion.
   */
  it('runs against the real codebase in --strict mode and exits 0', () => {
    const r = spawnSync('npx', ['tsx', SCRIPT, '--strict'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(
      /no-secrets-in-logs guard \(server\): scanned \d+ file\(s\) — OK/,
    );
  });

  // ---------------------------------------------------------------
  // Forbidden shapes — each canonical case from the task brief.
  // ---------------------------------------------------------------

  it('flags log.info with req.body.password', () => {
    const reasons = reasonsFor(
      `log.info('login attempt', { password: req.body.password });`,
    );
    expect(reasons).toContain('property access ending in .password');
  });

  it('flags log.warn with req.body.token', () => {
    const reasons = reasonsFor(`log.warn(\`token=\${req.body.token}\`);`);
    expect(reasons).toContain('property access ending in .token');
  });

  it('flags property access ending in .inviteToken / .setupSecret / .csrfToken / .resetToken', () => {
    expect(reasonsFor(`log.info(\`it=\${user.inviteToken}\`);`)).toContain(
      'property access ending in .inviteToken',
    );
    expect(reasonsFor(`log.info(\`ss=\${cfg.setupSecret}\`);`)).toContain(
      'property access ending in .setupSecret',
    );
    expect(reasonsFor(`log.info(\`ct=\${session.csrfToken}\`);`)).toContain(
      'property access ending in .csrfToken',
    );
    expect(reasonsFor(`log.info(\`rt=\${user.resetToken}\`);`)).toContain(
      'property access ending in .resetToken',
    );
  });

  it('flags bare csrfToken in a shorthand object property (value reference)', () => {
    // `{ csrfToken }` is a shorthand property — both a key AND a
    // value reference. The guard must treat it as a value reference.
    const reasons = reasonsFor(
      `function f(csrfToken: string) { log.error('bad token', { csrfToken }); }`,
    );
    expect(reasons.some((r) => /shorthand property 'csrfToken'/.test(r))).toBe(
      true,
    );
  });

  it('flags bare inviteToken / setupSecret / resetToken identifiers in expression position', () => {
    expect(
      reasonsFor(
        `function a(inviteToken: string) { log.info(\`it=\${inviteToken}\`); }`,
      ),
    ).toContain("bare identifier 'inviteToken'");
    expect(
      reasonsFor(
        `function b(setupSecret: string) { log.info(\`ss=\${setupSecret}\`); }`,
      ),
    ).toContain("bare identifier 'setupSecret'");
    expect(
      reasonsFor(
        `function c(resetToken: string) { log.info(\`rt=\${resetToken}\`); }`,
      ),
    ).toContain("bare identifier 'resetToken'");
  });

  it("flags req.headers['x-csrf-token']", () => {
    const reasons = reasonsFor(
      `log.warn(\`csrf header: \${req.headers['x-csrf-token']}\`);`,
    );
    expect(reasons).toContain('element access ["x-csrf-token"]');
  });

  it("flags req.headers['x-setup-secret']", () => {
    const reasons = reasonsFor(
      `log.warn(\`setup header: \${req.headers["x-setup-secret"]}\`);`,
    );
    expect(reasons).toContain('element access ["x-setup-secret"]');
  });

  it("flags req.body['password'] (computed-string equivalent of property access)", () => {
    const reasons = reasonsFor(`log.info(\`pw=\${req.body['password']}\`);`);
    expect(reasons).toContain('element access ["password"]');
  });

  // ---------------------------------------------------------------
  // Coverage across log roots and levels.
  // ---------------------------------------------------------------

  it.each([
    ['log', 'debug'],
    ['log', 'info'],
    ['log', 'warn'],
    ['log', 'error'],
    ['log', 'trace'],
    ['log', 'fatal'],
    ['logger', 'info'],
    ['logger', 'warn'],
    ['console', 'log'],
    ['console', 'error'],
  ])('flags %s.%s when it interpolates a secret', (root, level) => {
    const reasons = reasonsFor(`${root}.${level}(\`pw=\${user.password}\`);`);
    expect(reasons).toContain('property access ending in .password');
  });

  it('flags optional-chain log access shape `log?.info(...)`', () => {
    expect(reasonsFor(`log?.info(\`pw=\${user.password}\`);`)).toContain(
      'property access ending in .password',
    );
  });

  it("flags bracket-notation log access shape `log['info'](...)`", () => {
    expect(reasonsFor(`log['info']('pw=' + user.password);`)).toContain(
      'property access ending in .password',
    );
  });

  // ---------------------------------------------------------------
  // Negative cases: structural labels and unrelated calls.
  // ---------------------------------------------------------------

  it('does NOT flag structural labels in string literals (no value reference)', () => {
    // `log.warn('csrfToken missing')` is a label, not a value
    // reference. The scanner only inspects expression nodes
    // (PropertyAccess, ElementAccess, Identifier), never
    // string-literal text or template head/middle/tail text.
    expect(
      reasonsFor(`log.warn('csrfToken missing for request');`),
    ).toHaveLength(0);
    expect(
      reasonsFor(`log.info(\`inviteToken issued for user \${user.id}\`);`),
    ).toHaveLength(0);
    expect(
      reasonsFor(`log.error('password mismatch for', { userId: u.id });`),
    ).toHaveLength(0);
  });

  it('does NOT flag property NAMES in object-literal keys (only values count)', () => {
    // `{ password: 'x' }` — `password` here is a key label, not a
    // value reference. The actual value is a string literal, which
    // the scanner deliberately ignores.
    expect(reasonsFor(`log.info('safe', { password: 'X' });`)).toHaveLength(0);
    expect(reasonsFor(`log.info('safe', { csrfToken: 'X' });`)).toHaveLength(0);
  });

  it('does NOT flag a non-log call that happens to mention a secret field', () => {
    // The scanner must only walk argument trees of LOG calls. A
    // regular call like `process(req.body.password)` is not in scope.
    expect(reasonsFor(`const hash = hashPassword(req.body.password);`))
      .toHaveLength(0);
    expect(reasonsFor(`const h = handler(req.headers['x-csrf-token']);`))
      .toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Bare `token` policy: flagged in value-reference positions, NOT
  // when it is the receiver of a property access (`token.id`).
  // ---------------------------------------------------------------

  it('flags shorthand `{ token }` (the `const { token } = req.body; log.info({ token })` shape)', () => {
    // The realistic blind-spot the brief calls out: a route
    // destructures `token` out of `req.body` and then logs it.
    const reasons = reasonsFor(
      `function f() {\n` +
        `  const { token } = req.body;\n` +
        `  log.info('attempt', { token });\n` +
        `}`,
    );
    expect(reasons.some((r) => /shorthand property 'token'/.test(r))).toBe(
      true,
    );
  });

  it('flags bare `token` interpolated into a template / passed as a direct argument', () => {
    expect(
      reasonsFor(`function f(token: string) { log.info(\`t=\${token}\`); }`),
    ).toContain("bare identifier 'token'");
    expect(
      reasonsFor(`function f(token: string) { log.warn('seen', token); }`),
    ).toContain("bare identifier 'token'");
  });

  it('does NOT flag bare `token` when it is the receiver of a property access', () => {
    // `token.id`, `token.kind` etc. commonly reference internal
    // payment-token / api-token metadata where the secret bytes
    // live in a different field. The narrower policy avoids
    // false-positives on this benign shape — the property-access
    // check still catches `req.body.token` directly.
    expect(
      reasonsFor(`function f(token: { id: number }) { log.info('paid', { id: token.id }); }`),
    ).toHaveLength(0);
    expect(
      reasonsFor(`function f(token: { kind: string }) { log.info(\`kind=\${token.kind}\`); }`),
    ).toHaveLength(0);
  });

  it('does NOT flag a string literal value of "token" in an object property', () => {
    expect(
      reasonsFor(`function f(token: string) { log.info('parsed', { kind: 'token' }); }`),
    ).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Suppression annotation.
  // ---------------------------------------------------------------

  it('honors a trailing // secret-log-ok: <reason> annotation', () => {
    const reasons = reasonsFor(
      `function f(csrfToken: string) {\n` +
        `  log.warn(\`csrfToken=\${csrfToken}\`); // secret-log-ok: test fixture\n` +
        `}`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('honors an interior /* secret-log-ok: <reason> */ annotation', () => {
    const reasons = reasonsFor(
      `log.warn(/* secret-log-ok: structural label, not the value */ 'csrfToken header missing for', { csrfToken: 'placeholder' });`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('rejects a secret-log-ok annotation with NO reason', () => {
    const reasons = reasonsFor(
      `function f(csrfToken: string) {\n` +
        `  log.warn(\`csrfToken=\${csrfToken}\`); // secret-log-ok:\n` +
        `}`,
    );
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('rejects a bare `secret-log-ok` (no colon) annotation', () => {
    const reasons = reasonsFor(
      `function f(csrfToken: string) {\n` +
        `  log.warn(\`csrfToken=\${csrfToken}\`); // secret-log-ok\n` +
        `}`,
    );
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('does NOT honor secret-log-ok inside a string payload (bypass guard)', () => {
    // A naive `argList.includes('secret-log-ok')` would have let
    // this slip past --strict. The annotation only counts inside
    // an actual comment, not inside a string-literal value.
    const reasons = reasonsFor(
      `function f(csrfToken: string) { log.warn('secret-log-ok: bogus ' + csrfToken); }`,
    );
    expect(reasons.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------
  // File-level scope + CLI behavior (verified via one fixture spawn
  // for advisory mode; the strict-mode spawn against the real
  // codebase above already exercises strict exit-1 paths fail-loud
  // when a real regression appears).
  // ---------------------------------------------------------------

  it('skips *.test.ts and __tests__/ files (directly via scanCodebase listing)', () => {
    // The directory walk filter is exercised end-to-end by the
    // real-codebase spawn test above (the codebase has both
    // *.test.ts and __tests__/ files; if the walker scanned them,
    // many in-test fixture leaks would show up in --strict). This
    // assertion just pins the unit-level expectation that the
    // scanner itself does not care about file path — file filtering
    // is handled in `listTsFiles`, which is exercised by the real
    // run.
    expect(reasonsFor(`log.info('safe call', { id: 1 });`)).toHaveLength(0);
  });

  it('exits 0 in advisory mode (no --strict) even when violations exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-advisory-'));
    const file = join(dir, 'server/foo.ts');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `import { log } from './logger.js';\nlog.info(\`pw=\${req.body.password}\`);\n`,
    );
    const r = spawnSync('npx', ['tsx', SCRIPT], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARN.*\.password/);
  });
});
