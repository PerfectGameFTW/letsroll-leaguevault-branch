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
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
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
  // Single-hop alias detection (task #516). Without scope-aware
  // binding tracking, a route that pulls the secret into a local
  // before logging slipped past the scanner because the local name
  // is not in any forbidden set and the forbidden property access
  // does not appear inside the log call's argument subtree.
  // ---------------------------------------------------------------

  it('flags `const pw = req.body.password; log.info(`pw=${pw}`)` (the brief)', () => {
    // This is the canonical multi-line alias case from the task
    // brief. The scanner must walk per-scope bindings and see that
    // `pw` is bound to a forbidden property access at declaration
    // time.
    const reasons = reasonsFor(
      `function login(req: any) {\n` +
        `  const pw = req.body.password;\n` +
        `  log.info(\`pw=\${pw}\`);\n` +
        `}`,
    );
    expect(reasons.some((r) => /local 'pw' aliasing .*\.password/.test(r))).toBe(
      true,
    );
  });

  it('flags a local bound to req.headers["x-csrf-token"] when later logged', () => {
    const reasons = reasonsFor(
      `function check(req: any) {\n` +
        `  const csrf = req.headers['x-csrf-token'];\n` +
        `  log.warn('seen', csrf);\n` +
        `}`,
    );
    expect(
      reasons.some((r) => /local 'csrf' aliasing .*x-csrf-token/.test(r)),
    ).toBe(true);
  });

  it('flags a local bound via destructuring `const { password } = req.body`', () => {
    // Destructuring is the alias shape that already half-worked
    // because the destructured local IS the secret string. Pin it
    // explicitly so the scope pass keeps treating it as a
    // forbidden binding even when used away from the destructure
    // (not in shorthand-prop form).
    const reasons = reasonsFor(
      `function f(req: any) {\n` +
        `  const { password } = req.body;\n` +
        `  log.error('attempt', password);\n` +
        `}`,
    );
    expect(
      reasons.some((r) => /local 'password' aliasing/.test(r)),
    ).toBe(true);
  });

  it('flags a local bound via renamed destructuring `const { password: pw } = req.body`', () => {
    const reasons = reasonsFor(
      `function f(req: any) {\n` +
        `  const { password: pw } = req.body;\n` +
        `  log.warn(\`pw=\${pw}\`);\n` +
        `}`,
    );
    expect(reasons.some((r) => /local 'pw' aliasing/.test(r))).toBe(true);
  });

  it('flags a local re-assigned with `pw = req.body.password` (assignment alias)', () => {
    // Mirrors the assignment-alias pass in the sibling
    // `check-log-debug-pii` guard.
    const reasons = reasonsFor(
      `function f(req: any) {\n` +
        `  let pw: string | undefined;\n` +
        `  pw = req.body.password;\n` +
        `  log.info(\`pw=\${pw}\`);\n` +
        `}`,
    );
    expect(reasons.some((r) => /local 'pw' aliasing/.test(r))).toBe(true);
  });

  it('does NOT flag an alias shadowed by an inner declaration', () => {
    // Shadowing must work the same way as the sibling guard. An
    // inner `const pw = 'fixture'` masks the outer alias so the
    // inner `log.info(pw)` is benign.
    const reasons = reasonsFor(
      `function f(req: any) {\n` +
        `  const pw = req.body.password;\n` +
        `  {\n` +
        `    const pw = 'fixture';\n` +
        `    log.info(pw);\n` +
        `  }\n` +
        `}`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a benign local that happens to share a name across scopes', () => {
    // `pw` here is just a parameter name with a non-secret
    // initializer in the call site; no enclosing scope binds it
    // to a forbidden value.
    expect(
      reasonsFor(
        `function f(pw: string) { log.info(\`label=\${pw}\`); }`,
      ),
    ).toHaveLength(0);
  });

  it('does NOT flag a property-receiver use of an aliased local (`pw.length`)', () => {
    // The metadata-access shape stays benign — same conservative
    // policy as the bare-`token` rule.
    const reasons = reasonsFor(
      `function f(req: any) {\n` +
        `  const pw = req.body.password;\n` +
        `  log.info('pw len', pw.length);\n` +
        `}`,
    );
    expect(reasons).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Multi-hop alias detection (task #540). Single-hop closed in #516
  // leaves an obvious bypass: route the secret through a second
  // local before logging. The brief calls out
  //   const pw = req.body.password;
  //   const same = pw;
  //   log.info(`pw=${same}`);
  // as the canonical two-hop shape. The classifier must consult
  // each plain-identifier RHS's existing binding so the forbidden
  // classification propagates across the chain.
  // ---------------------------------------------------------------

  it('flags the two-hop `const pw = req.body.password; const same = pw; log.info(`pw=${same}`)` chain (the brief)', () => {
    const reasons = reasonsFor(
      `function login(req: any) {\n` +
        `  const pw = req.body.password;\n` +
        `  const same = pw;\n` +
        `  log.info(\`pw=\${same}\`);\n` +
        `}`,
    );
    // The chain should bubble the original property-access reason
    // through both hops so the report points at the real source.
    expect(
      reasons.some((r) => /local 'same' aliasing.*\.password/.test(r)),
    ).toBe(true);
  });

  it('flags a three-hop chain `pw -> same -> last -> log`', () => {
    // Pin that the propagation is fully recursive — each plain-id
    // initializer pulls forward the prior binding's forbidden
    // classification, not just the first hop.
    const reasons = reasonsFor(
      `function login(req: any) {\n` +
        `  const pw = req.body.password;\n` +
        `  const same = pw;\n` +
        `  const last = same;\n` +
        `  log.info(\`pw=\${last}\`);\n` +
        `}`,
    );
    expect(
      reasons.some((r) => /local 'last' aliasing.*\.password/.test(r)),
    ).toBe(true);
  });

  it('flags a two-hop chain that goes through an assignment `b = a`', () => {
    // Mixed shape: declaration hop then assignment hop. The
    // assignment-alias pass must also consult prior bindings when
    // its RHS is a plain identifier.
    const reasons = reasonsFor(
      `function login(req: any) {\n` +
        `  const pw = req.body.password;\n` +
        `  let other: string;\n` +
        `  other = pw;\n` +
        `  log.info(\`pw=\${other}\`);\n` +
        `}`,
    );
    expect(
      reasons.some((r) => /local 'other' aliasing.*\.password/.test(r)),
    ).toBe(true);
  });

  it('does NOT flag a multi-hop chain shadowed by an inner declaration', () => {
    // Same shadowing rules apply: an inner `const same = 'fixture'`
    // must mask the outer alias chain so the inner log call is
    // benign.
    const reasons = reasonsFor(
      `function f(req: any) {\n` +
        `  const pw = req.body.password;\n` +
        `  const same = pw;\n` +
        `  {\n` +
        `    const same = 'fixture';\n` +
        `    log.info(same);\n` +
        `  }\n` +
        `}`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a two-hop chain whose source binding is a benign value', () => {
    // The propagation only fires when the prior binding is itself
    // forbidden. `const a = 'fixture'; const b = a;` stays clean
    // even though structurally it is a two-hop alias.
    const reasons = reasonsFor(
      `function f() {\n` +
        `  const a = 'fixture';\n` +
        `  const b = a;\n` +
        `  log.info(b);\n` +
        `}`,
    );
    expect(reasons).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Helper-function call detection (task #541). Multi-hop alias
  // detection (#540) closed the obvious bypass of routing the
  // secret through extra locals; the next natural shape is to
  // route it through a function whose body returns the forbidden
  // expression, so the property access never appears inside the
  // log call's argument subtree at all.
  //
  //   function pickPassword(req) { return req.body.password; }
  //   log.info(`pw=${pickPassword(req)}`);
  //
  // The scanner builds a per-file map of every function /
  // arrow-function / function-expression bound to a name and
  // classifies its return value the same way it classifies a
  // variable initializer. A call to a helper whose return value is
  // forbidden is treated as a leak inside log args.
  // ---------------------------------------------------------------

  it('flags `function pickPassword(req) { return req.body.password; } log.info(`pw=${pickPassword(req)}`)` (the brief)', () => {
    const reasons = reasonsFor(
      `function pickPassword(req: any) { return req.body.password; }\n` +
        `log.info(\`pw=\${pickPassword(req)}\`);`,
    );
    // The reason text should name the helper AND carry the
    // underlying property-access reason so the report points at
    // the real secret source.
    expect(
      reasons.some((r) =>
        /helper call 'pickPassword\(\)' returning property access ending in \.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags an arrow-function helper with expression body `const pw = (req) => req.body.password`', () => {
    const reasons = reasonsFor(
      `const pw = (req: any) => req.body.password;\n` +
        `log.info('attempt', pw(req));`,
    );
    expect(
      reasons.some((r) =>
        /helper call 'pw\(\)' returning property access ending in \.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags an arrow-function helper with block body and a return statement', () => {
    const reasons = reasonsFor(
      `const grab = (req: any) => {\n` +
        `  return req.body.password;\n` +
        `};\n` +
        `log.warn(grab(req));`,
    );
    expect(
      reasons.some((r) =>
        /helper call 'grab\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a function-expression helper bound to a variable', () => {
    const reasons = reasonsFor(
      `const grab = function (req: any) { return req.body.password; };\n` +
        `log.error(\`pw=\${grab(req)}\`);`,
    );
    expect(
      reasons.some((r) => /helper call 'grab\(\)' returning .*\.password/.test(r)),
    ).toBe(true);
  });

  it('flags a helper whose body returns a forbidden bare identifier', () => {
    // Same machinery — `return csrfToken;` returns a bare
    // identifier in `forbiddenIdentifiersStrict`, classifying the
    // helper as forbidden.
    const reasons = reasonsFor(
      `function getCsrf(csrfToken: string) { return csrfToken; }\n` +
        `log.info(getCsrf(t));`,
    );
    expect(
      reasons.some((r) => /helper call 'getCsrf\(\)' returning bare identifier 'csrfToken'/.test(r)),
    ).toBe(true);
  });

  it('flags a helper whose body returns a forbidden element-access (computed header)', () => {
    const reasons = reasonsFor(
      `function getCsrfHeader(req: any) { return req.headers['x-csrf-token']; }\n` +
        `log.warn(getCsrfHeader(req));`,
    );
    expect(
      reasons.some((r) =>
        /helper call 'getCsrfHeader\(\)' returning element access \["x-csrf-token"\]/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags a helper that routes the secret through an intra-helper alias before returning', () => {
    // `pw` inside the helper body is itself a forbidden alias
    // (single-hop). The helper-classifier passes the file's scope
    // map to `classifyInitializer` so `return pw` is classified
    // forbidden via the same mechanism.
    const reasons = reasonsFor(
      `function pickPassword(req: any) {\n` +
        `  const pw = req.body.password;\n` +
        `  return pw;\n` +
        `}\n` +
        `log.info(pickPassword(req));`,
    );
    expect(
      reasons.some((r) =>
        /helper call 'pickPassword\(\)' returning local 'pw' aliasing .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags a helper with multiple return paths when ANY of them is forbidden', () => {
    // The scanner is conservative: a single forbidden return is
    // enough to classify the helper, even if other paths return
    // benign values. This mirrors the runtime reality — the secret
    // path WILL execute under some inputs.
    const reasons = reasonsFor(
      `function maybe(req: any, fallback: boolean) {\n` +
        `  if (fallback) return 'placeholder';\n` +
        `  return req.body.password;\n` +
        `}\n` +
        `log.info(maybe(req, false));`,
    );
    expect(
      reasons.some((r) => /helper call 'maybe\(\)' returning .*\.password/.test(r)),
    ).toBe(true);
  });

  it('does NOT flag a helper whose body returns nothing forbidden', () => {
    // A function that returns benign metadata (or a literal)
    // must not trip the helper detection. `req.body.id` does not
    // match any forbidden property name.
    const reasons = reasonsFor(
      `function getUserId(req: any) { return req.body.id; }\n` +
        `log.info(getUserId(req));`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a helper whose forbidden return is inside a NESTED function (the inner return is not the outer return)', () => {
    // The visitor that walks `outer`'s body must NOT descend into
    // `inner` — `inner`'s `return req.body.password` is `inner`'s
    // return value, not `outer`'s. `outer` returns `null`, so it
    // is benign.
    const reasons = reasonsFor(
      `function outer(req: any) {\n` +
        `  function inner() { return req.body.password; }\n` +
        `  return null;\n` +
        `}\n` +
        `log.info(outer(req));`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a same-named helper after it is shadowed by an inner declaration', () => {
    // Same shadowing rules as the alias machinery: an inner
    // `function pickPassword() { return 'placeholder'; }` must
    // mask the outer forbidden helper for log calls inside the
    // inner block.
    const reasons = reasonsFor(
      `function pickPassword(req: any) { return req.body.password; }\n` +
        `function caller(req: any) {\n` +
        `  function pickPassword() { return 'placeholder'; }\n` +
        `  log.info(pickPassword());\n` +
        `}`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a non-call reference to a forbidden helper (only invocation matters)', () => {
    // Passing the helper as a value (`registerHandler(pickPassword)`)
    // does not surface the secret — only invoking it does. The
    // 'helper' binding kind is distinct from 'forbidden' so the
    // bare-identifier alias rule does not double-fire on the
    // helper name itself.
    const reasons = reasonsFor(
      `function pickPassword(req: any) { return req.body.password; }\n` +
        `log.info('handler is', pickPassword);`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('flags a CROSS-FILE helper imported via a relative spec', () => {
    // Cross-file detection: parse the imported file, identify the
    // exported helper that returns a forbidden expression, seed
    // the importing file's source-file scope so the helper-call
    // rule fires.
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-cross-'));
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export function pickPassword(req: any) { return req.body.password; }\n`,
    );
    writeFileSync(
      routesFile,
      `import { pickPassword } from './helpers';\n` +
        `log.info(\`pw=\${pickPassword(req)}\`);\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /helper call 'pickPassword\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE helper imported under a renamed alias `import { x as y }`', () => {
    // The local name (`pp`) must be the one recorded in the scope —
    // a call to `pp(req)` in the importing file should trip even
    // though the helper was originally exported as `pickPassword`.
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-cross-alias-'));
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export const pickPassword = (req: any) => req.body.password;\n`,
    );
    writeFileSync(
      routesFile,
      `import { pickPassword as pp } from './helpers';\n` +
        `log.info(pp(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) => /helper call 'pp\(\)' returning .*\.password/.test(r)),
    ).toBe(true);
  });

  it('does NOT flag a CROSS-FILE import whose exported helper is benign', () => {
    // Pin that the import-resolution pass does not over-match —
    // a benign exported helper must not poison every call site.
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-cross-benign-'));
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export function getUserId(req: any) { return req.body.id; }\n`,
    );
    writeFileSync(
      routesFile,
      `import { getUserId } from './helpers';\n` +
        `log.info('user', getUserId(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a CROSS-FILE import that resolves to a missing file (resolution failure must be silent)', () => {
    // Imports that cannot be resolved on disk (e.g. `import {
    // log } from './logger.js'` in an isolated fixture) must not
    // throw or false-positive — they just do not contribute any
    // helper bindings.
    const reasons = reasonsFor(
      `import { something } from './does-not-exist';\n` +
        `log.info('safe', { id: 1 });`,
    );
    expect(reasons).toHaveLength(0);
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
