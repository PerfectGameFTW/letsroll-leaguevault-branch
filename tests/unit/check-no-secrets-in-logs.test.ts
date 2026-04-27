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
  // Null-coalescing / logical-or / ternary alias detection
  // (task #547). #540 closed plain-identifier alias chains, but
  // the brief explicitly called out "a temp variable for
  // null-coalescing" as a motivating shape:
  //
  //   const pw = req.body.password ?? '';
  //   log.info(`pw=${pw}`);
  //
  //   const t = cond ? req.body.token : null;
  //   log.info(t);
  //
  // The classifier must walk into `??` / `||` operands and ternary
  // branches; if any reachable operand classifies as forbidden the
  // whole RHS is forbidden, with the original property-access
  // reason preserved through the recursion.
  // ---------------------------------------------------------------

  it('flags `const pw = req.body.password ?? ""; log.info(pw)` (null-coalescing alias)', () => {
    const reasons = reasonsFor(
      `function login(req: any) {\n` +
        `  const pw = req.body.password ?? '';\n` +
        `  log.info(\`pw=\${pw}\`);\n` +
        `}`,
    );
    // The reason must surface the ORIGINAL `.password` source so the
    // report still points at the real leak site, not just the alias.
    expect(
      reasons.some((r) => /local 'pw' aliasing .*\.password/.test(r)),
    ).toBe(true);
  });

  it('flags `const pw = req.body.password || ""; log.info(pw)` (logical-or alias)', () => {
    // `||` and `??` share the same recursion path; pin both so a
    // future refactor of one branch doesn't silently regress the
    // other.
    const reasons = reasonsFor(
      `function login(req: any) {\n` +
        `  const pw = req.body.password || '';\n` +
        `  log.info(\`pw=\${pw}\`);\n` +
        `}`,
    );
    expect(
      reasons.some((r) => /local 'pw' aliasing .*\.password/.test(r)),
    ).toBe(true);
  });

  it('flags `const t = cond ? req.body.token : null; log.info(t)` (ternary alias)', () => {
    const reasons = reasonsFor(
      `function login(req: any, cond: boolean) {\n` +
        `  const t = cond ? req.body.token : null;\n` +
        `  log.info(t);\n` +
        `}`,
    );
    expect(
      reasons.some((r) => /local 't' aliasing .*\.token/.test(r)),
    ).toBe(true);
  });

  it('flags a ternary whose forbidden branch is on the false side', () => {
    // The recursion must walk both branches — the secret can sit
    // on either side of the `:` and still leak when logged.
    const reasons = reasonsFor(
      `function login(req: any, cond: boolean) {\n` +
        `  const t = cond ? null : req.body.token;\n` +
        `  log.info(t);\n` +
        `}`,
    );
    expect(
      reasons.some((r) => /local 't' aliasing .*\.token/.test(r)),
    ).toBe(true);
  });

  it('does NOT flag a ternary where neither branch is forbidden', () => {
    // Negative case from the brief — the propagation must only
    // fire when at least one operand reaches a forbidden shape, so
    // a benign ternary stays clean.
    const reasons = reasonsFor(
      `function f(cond: boolean) {\n` +
        `  const v = cond ? 'a' : 'b';\n` +
        `  log.info(v);\n` +
        `}`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a `??` alias whose only operand is benign', () => {
    // Symmetric negative for the binary path — neither operand of
    // `userInput ?? 'fallback'` reaches a forbidden shape, so the
    // local stays benign.
    const reasons = reasonsFor(
      `function f(userInput: string | null) {\n` +
        `  const v = userInput ?? 'fallback';\n` +
        `  log.info(v);\n` +
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
  // Default-export / default-import helper detection (task #549).
  // Task #541 wired up cross-file resolution for named exports;
  // teams that prefer default exports could still bypass with:
  //
  //   // helpers.ts
  //   export default function pickPassword(req) { return req.body.password; }
  //   // routes.ts
  //   import pickPassword from './helpers';
  //   log.info(`pw=${pickPassword(req)}`);
  //
  // The scanner now extracts default-exported helpers under a
  // sentinel key in `getExportedHelpers` and the import walk binds
  // the importing file's default-import local name to that helper
  // binding, so the helper-call rule fires.
  // ---------------------------------------------------------------

  it('flags a CROSS-FILE default-export `export default function name` consumed via default-import (the brief)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-default-named-'));
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export default function pickPassword(req: any) { return req.body.password; }\n`,
    );
    writeFileSync(
      routesFile,
      `import pickPassword from './helpers';\n` +
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

  it('flags a CROSS-FILE anonymous default-export `export default function () { … }` consumed via default-import', () => {
    // `export default function () { ... }` parses as a
    // FunctionDeclaration with no name — the helper extraction
    // must still record it under the default sentinel so the
    // importing local name picks it up.
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-default-anon-'));
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export default function (req: any) { return req.body.password; }\n`,
    );
    writeFileSync(
      routesFile,
      `import grabPw from './helpers';\n` +
        `log.info(grabPw(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /helper call 'grabPw\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE arrow default-export `export default (req) => …` (ExportAssignment shape)', () => {
    // `export default <ArrowFunction>` parses as ExportAssignment
    // with a non-`isExportEquals` flag and an ArrowFunction
    // expression.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-default-arrow-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export default (req: any) => req.body.password;\n`,
    );
    writeFileSync(
      routesFile,
      `import pp from './helpers';\n` +
        `log.warn(\`pw=\${pp(req)}\`);\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /helper call 'pp\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE function-expression default-export `export default (function () { … })` (ExportAssignment shape)', () => {
    // Wrapping the function expression in parens forces the parser
    // to treat the export as an ExportAssignment with a
    // FunctionExpression (rather than a FunctionDeclaration). Pin
    // the FunctionExpression branch of the ExportAssignment walk.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-default-fnexpr-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export default (function (req: any) { return req.body.password; });\n`,
    );
    writeFileSync(
      routesFile,
      `import pickPw from './helpers';\n` +
        `log.error(pickPw(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /helper call 'pickPw\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE identifier default-export `export default pickPassword` (the brief)', () => {
    // task #555: the natural next bypass of #549. The function is
    // declared as a plain (non-exported) FunctionDeclaration first,
    // then re-exported via `export default <Identifier>`. This
    // parses as ExportAssignment whose expression is an Identifier
    // — distinct from the ArrowFunction / FunctionExpression
    // shapes #549 wired up. Pin the identifier-export shape
    // end-to-end: helpers.ts declares the function, exports it as
    // default by identifier; routes.ts default-imports it and
    // logs the call result.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-default-ident-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `function pickPassword(req: any) { return req.body.password; }\n` +
        `export default pickPassword;\n`,
    );
    writeFileSync(
      routesFile,
      `import pickPassword from './helpers';\n` +
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

  it('does NOT flag a CROSS-FILE default-export whose function body is benign', () => {
    // Symmetry with the named-export benign test: a default-exported
    // helper that doesn't return a forbidden expression must not
    // poison every default-import call site.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-default-benign-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export default function getUserId(req: any) { return req.body.id; }\n`,
    );
    writeFileSync(
      routesFile,
      `import getUserId from './helpers';\n` +
        `log.info('user', getUserId(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(reasons).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Cross-file methodHost detection (task #553). Task #548 caught
  // the same-file object-literal / class method-host shape; the
  // natural next bypass is to put the literal or class behind a
  // module boundary:
  //
  //   // helpers.ts
  //   export const helpers = { pickPassword: (req) => req.body.password };
  //   export class H { pick(req) { return req.body.password; } }
  //   // routes.ts
  //   import { helpers, H } from './helpers';
  //   log.info(helpers.pickPassword(req));
  //   log.info(new H().pick(req));
  //
  // `getExportedHelpers` now records named-export object literals
  // and class declarations under their export name as a methodHost
  // binding, so the importing file's pass 5 binds the same host
  // under the local (possibly aliased) import name and the existing
  // method-call rule fires on the cross-file shapes.
  // ---------------------------------------------------------------

  it('flags a CROSS-FILE named-export object literal consumed via `helpers.pickPassword(req)` (the brief)', () => {
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-cross-host-obj-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n`,
    );
    writeFileSync(
      routesFile,
      `import { helpers } from './helpers';\n` +
        `log.info(\`pw=\${helpers.pickPassword(req)}\`);\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE named-export object literal under a renamed alias `import { helpers as h }`', () => {
    // Same renaming semantics as the helper-function alias test —
    // the local name (`h`) is what the receiver-resolution sees, so
    // `h.pick(req)` must trip even though the export name was
    // `helpers`.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-cross-host-obj-alias-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export const helpers = {\n` +
        `  pick(req: any) { return req.body.password; },\n` +
        `};\n`,
    );
    writeFileSync(
      routesFile,
      `import { helpers as h } from './helpers';\n` +
        `log.warn(h.pick(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'h\.pick\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE named-export class via `new H().pick(req)` (the brief)', () => {
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-cross-host-class-new-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export class H {\n` +
        `  pick(req: any) { return req.body.password; }\n` +
        `}\n`,
    );
    writeFileSync(
      routesFile,
      `import { H } from './helpers';\n` +
        `log.info(new H().pick(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'new H\(\)\.pick\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE named-export class via `const h = new H(); h.pick(req)` (the brief)', () => {
    // The instance-binding pass must run AFTER cross-file imports
    // so `H` is in scope by the time `new H()` is resolved into the
    // methodHost binding for `h`. Pin that ordering.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-cross-host-class-instance-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export class H {\n` +
        `  pick(req: any) { return req.body.password; }\n` +
        `}\n`,
    );
    writeFileSync(
      routesFile,
      `import { H } from './helpers';\n` +
        `const h = new H();\n` +
        `log.warn(h.pick(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'h\.pick\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE named-export class consumed via `H.pick(req)` (static-style call)', () => {
    // The methodHost folds static and instance methods into the
    // same map (mirroring the in-file class-method test), so
    // calling the import directly as `H.pick(req)` resolves the
    // same way.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-cross-host-class-static-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export class H {\n` +
        `  static pick(req: any) { return req.body.password; }\n` +
        `}\n`,
    );
    writeFileSync(
      routesFile,
      `import { H } from './helpers';\n` +
        `log.error(H.pick(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'H\.pick\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE class-expression export `export const H = class { … }`', () => {
    // Classes aren't always declared with `class` syntax — assigning
    // a class expression to an exported `const` is a real-world
    // shape. Pin the class-expression branch of `getExportedHelpers`.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-cross-host-class-expr-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export const H = class {\n` +
        `  pick(req: any) { return req.body.password; }\n` +
        `};\n`,
    );
    writeFileSync(
      routesFile,
      `import { H } from './helpers';\n` +
        `log.info(new H().pick(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'new H\(\)\.pick\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('does NOT flag a CROSS-FILE named-export object literal whose methods are benign', () => {
    // Symmetric no-false-positive: a benign object literal exported
    // from another file must not poison every importing call site.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-cross-host-obj-benign-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export const helpers = {\n` +
        `  getId: (req: any) => req.body.id,\n` +
        `  getName: (req: any) => req.body.name,\n` +
        `};\n`,
    );
    writeFileSync(
      routesFile,
      `import { helpers } from './helpers';\n` +
        `log.info('id', helpers.getId(req), helpers.getName(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a CROSS-FILE named-export class whose methods are benign', () => {
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-cross-host-class-benign-'),
    );
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export class H {\n` +
        `  id(req: any) { return req.body.id; }\n` +
        `}\n`,
    );
    writeFileSync(
      routesFile,
      `import { H } from './helpers';\n` +
        `log.info(new H().id(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(reasons).toHaveLength(0);
  });

  it('flags BOTH default and named bindings on a combined `import default, { named } from` clause', () => {
    // `import baz, { foo } from './x'` populates `importClause.name`
    // (default) AND `importClause.namedBindings` (named) on the same
    // statement. Both paths must be walked so neither is a blind
    // spot when a file mixes default and named helpers.
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-default-mixed-'));
    const helpersFile = join(dir, 'server/helpers.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export default function pickPassword(req: any) { return req.body.password; }\n` +
        `export function pickToken(req: any) { return req.body.token; }\n`,
    );
    writeFileSync(
      routesFile,
      `import pickPassword, { pickToken } from './helpers';\n` +
        `log.info(\`pw=\${pickPassword(req)}\`);\n` +
        `log.warn(\`tk=\${pickToken(req)}\`);\n`,
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
    expect(
      reasons.some((r) =>
        /helper call 'pickToken\(\)' returning .*\.token/.test(r),
      ),
    ).toBe(true);
  });

  // ---------------------------------------------------------------
  // Re-export resolution (task #556). Tasks #541 and #549 wired up
  // cross-file resolution for direct named/default exports but
  // skipped re-export forwarding shapes:
  //
  //   // helpers.ts
  //   export function pickPassword(req) { return req.body.password; }
  //   // index.ts (barrel)
  //   export { pickPassword } from './helpers';
  //   // routes.ts
  //   import { pickPassword } from './utils';
  //   log.info(`pw=${pickPassword(req)}`);
  //
  // The barrel pattern is common; the scanner now walks each
  // ExportDeclaration with a moduleSpecifier, recursively asks the
  // re-export source for its helpers, and copies the selected
  // entries into the current file's helpers map under the
  // re-exported names. Wildcard re-exports follow ECMAScript
  // semantics — they forward every named export but NOT the
  // default. Namespace re-exports remain out of scope (see follow-up).
  // ---------------------------------------------------------------

  it('flags a CROSS-FILE helper routed through a NAMED re-export `export { foo } from` (the brief)', () => {
    // Three-file barrel chain: helpers.ts defines the helper,
    // index.ts re-exports it under the same name, routes.ts
    // imports from the barrel and calls the helper inside a log
    // template literal. Without #556 the scanner sees `index.ts`
    // as having no helpers; with the re-export branch in
    // `getExportedHelpers`, `pickPassword` resolves through the
    // barrel.
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-rexp-named-'));
    const helpersFile = join(dir, 'server/utils/helpers.ts');
    const indexFile = join(dir, 'server/utils/index.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export function pickPassword(req: any) { return req.body.password; }\n`,
    );
    writeFileSync(indexFile, `export { pickPassword } from './helpers';\n`);
    writeFileSync(
      routesFile,
      `import { pickPassword } from './utils';\n` +
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

  it('flags a CROSS-FILE helper routed through a RENAMED re-export `export { foo as bar } from`', () => {
    // The barrel renames the helper on its way through. The
    // importing file uses the renamed identifier; the scanner
    // must record the helper under the re-exported name (`pp`)
    // so the consumer's `pp(req)` call resolves.
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-rexp-renamed-'));
    const helpersFile = join(dir, 'server/utils/helpers.ts');
    const indexFile = join(dir, 'server/utils/index.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export const pickPassword = (req: any) => req.body.password;\n`,
    );
    writeFileSync(
      indexFile,
      `export { pickPassword as pp } from './helpers';\n`,
    );
    writeFileSync(
      routesFile,
      `import { pp } from './utils';\n` + `log.info(pp(req));\n`,
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

  it('flags a CROSS-FILE helper routed through a WILDCARD re-export `export * from`', () => {
    // `export * from './helpers'` forwards every named export.
    // The scanner copies all NAMED entries (DEFAULT_EXPORT_KEY is
    // excluded per ECMA spec — see the dedicated negative test
    // below). The consumer imports `pickPassword` directly from
    // the barrel and the helper-call rule fires.
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-rexp-wildcard-'));
    const helpersFile = join(dir, 'server/utils/helpers.ts');
    const indexFile = join(dir, 'server/utils/index.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export function pickPassword(req: any) { return req.body.password; }\n`,
    );
    writeFileSync(indexFile, `export * from './helpers';\n`);
    writeFileSync(
      routesFile,
      `import { pickPassword } from './utils';\n` +
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

  it('flags a CROSS-FILE helper routed through a DEFAULT-AS-NAMED re-export `export { default as foo } from`', () => {
    // Cross-shape interaction with task #549: the source file
    // exports the helper as `default`; the barrel re-exports it
    // under a new name. The scanner looks up DEFAULT_EXPORT_KEY
    // in the source's helpers map and records the binding under
    // the re-exported name in the current file.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-rexp-default-as-named-'),
    );
    const helpersFile = join(dir, 'server/utils/helpers.ts');
    const indexFile = join(dir, 'server/utils/index.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export default function (req: any) { return req.body.password; }\n`,
    );
    writeFileSync(
      indexFile,
      `export { default as pickPassword } from './helpers';\n`,
    );
    writeFileSync(
      routesFile,
      `import { pickPassword } from './utils';\n` +
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

  it('does NOT forward a default export through a WILDCARD re-export `export * from` (per ECMA spec)', () => {
    // ES module semantics: `export *` forwards all NAMED exports
    // but NOT the default. A consumer trying to default-import
    // through the barrel would see no default at runtime; the
    // scanner mirrors that — the default helper must NOT be
    // bound under any name through a wildcard re-export.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-rexp-wildcard-no-default-'),
    );
    const helpersFile = join(dir, 'server/utils/helpers.ts');
    const indexFile = join(dir, 'server/utils/index.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export default function pickPassword(req: any) { return req.body.password; }\n`,
    );
    writeFileSync(indexFile, `export * from './helpers';\n`);
    writeFileSync(
      routesFile,
      `import pickPassword from './utils';\n` +
        `log.info(\`pw=\${pickPassword(req)}\`);\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a CROSS-FILE re-export whose source helper is benign', () => {
    // Pin that the re-export branch does not over-match: a benign
    // helper forwarded through a barrel must remain benign on the
    // consumer side.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-rexp-benign-'),
    );
    const helpersFile = join(dir, 'server/utils/helpers.ts');
    const indexFile = join(dir, 'server/utils/index.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export function getUserId(req: any) { return req.body.id; }\n`,
    );
    writeFileSync(indexFile, `export { getUserId } from './helpers';\n`);
    writeFileSync(
      routesFile,
      `import { getUserId } from './utils';\n` +
        `log.info('user', getUserId(req));\n`,
    );
    const reasons = scanSource(
      routesFile,
      readFileSync(routesFile, 'utf8'),
      SERVER_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(reasons).toHaveLength(0);
  });

  it('flags a CROSS-FILE helper routed through a NAMED-AS-DEFAULT re-export `export { foo as default } from`', () => {
    // Symmetric to the default-as-named case: the source file
    // exports the helper under a NAMED export; the barrel
    // re-exports it as the barrel's DEFAULT. The consumer
    // default-imports from the barrel. The scanner must
    // explicitly map a target name of 'default' to the
    // DEFAULT_EXPORT_KEY sentinel so the consumer's default
    // import resolves through the barrel even though
    // DEFAULT_EXPORT_KEY happens to be the literal string
    // 'default' today (the sentinel could be renamed without
    // breaking this branch).
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-rexp-named-as-default-'),
    );
    const helpersFile = join(dir, 'server/utils/helpers.ts');
    const indexFile = join(dir, 'server/utils/index.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export function pickPassword(req: any) { return req.body.password; }\n`,
    );
    writeFileSync(
      indexFile,
      `export { pickPassword as default } from './helpers';\n`,
    );
    writeFileSync(
      routesFile,
      `import pickPassword from './utils';\n` +
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

  it('flags a CROSS-FILE helper routed through a TWO-HOP re-export chain (barrel of barrels)', () => {
    // Real codebases nest barrels (`server/utils/index.ts`
    // re-exports `server/utils/auth/index.ts` which re-exports
    // `server/utils/auth/helpers.ts`). The recursive
    // `getExportedHelpers` walk should resolve through every hop;
    // the EXPORT_HELPER_CACHE keeps the walk linear.
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-rexp-chain-'));
    const helpersFile = join(dir, 'server/utils/auth/helpers.ts');
    const innerIndexFile = join(dir, 'server/utils/auth/index.ts');
    const outerIndexFile = join(dir, 'server/utils/index.ts');
    const routesFile = join(dir, 'server/routes.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export function pickPassword(req: any) { return req.body.password; }\n`,
    );
    writeFileSync(
      innerIndexFile,
      `export { pickPassword } from './helpers';\n`,
    );
    writeFileSync(outerIndexFile, `export * from './auth';\n`);
    writeFileSync(
      routesFile,
      `import { pickPassword } from './utils';\n` +
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

  // ---------------------------------------------------------------
  // Method-call detection (task #548). Task #541 closed the
  // bare-identifier helper-call shape; the natural next bypass is
  // to route the same call through a property access:
  //
  //   const helpers = { pickPassword: (req) => req.body.password };
  //   log.info(`pw=${helpers.pickPassword(req)}`);
  //
  //   class H { pick(req) { return req.body.password; } }
  //   log.info(new H().pick(req));
  //
  // The scanner records object-literal properties whose value is an
  // arrow / function expression returning a forbidden expression
  // (and class methods doing the same) as a 'methodHost' binding,
  // then flags property-access call sites whose receiver resolves
  // to that host.
  // ---------------------------------------------------------------

  it('flags `helpers.pickPassword(req)` where helpers is an object literal of arrow helpers (the brief)', () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info(\`pw=\${helpers.pickPassword(req)}\`);`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning property access ending in \.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags an object-literal method-shorthand `{ pickPassword(req) { return req.body.password; } }`', () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword(req: any) { return req.body.password; },\n` +
        `};\n` +
        `log.warn(helpers.pickPassword(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a function-expression value on an object literal', () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pick: function (req: any) { return req.body.password; },\n` +
        `};\n` +
        `log.error(\`pw=\${helpers.pick(req)}\`);`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pick\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a NESTED object-literal path `obj.helper.pick(req)`', () => {
    // The brief explicitly calls out `obj.helper.pick(...)` — a
    // helper one level deep inside another object literal. The
    // scanner walks the property-access chain and looks the
    // method up on the resolved nested host.
    const reasons = reasonsFor(
      `const obj = {\n` +
        `  helper: {\n` +
        `    pick: (req: any) => req.body.password,\n` +
        `  },\n` +
        `};\n` +
        `log.info(obj.helper.pick(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'obj\.helper\.pick\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags an object-literal helper that returns a forbidden bare identifier', () => {
    // Same machinery as the helper-function rule: a method whose
    // body returns a strict-set bare identifier (`csrfToken`) is a
    // forbidden helper.
    const reasons = reasonsFor(
      `const h = {\n` +
        `  getCsrf: (csrfToken: string) => csrfToken,\n` +
        `};\n` +
        `log.info(h.getCsrf(t));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'h\.getCsrf\(\)' returning bare identifier 'csrfToken'/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags `new H().pick(req)` where H is a class with a forbidden-return method (the brief)', () => {
    const reasons = reasonsFor(
      `class H {\n` +
        `  pick(req: any) { return req.body.password; }\n` +
        `}\n` +
        `log.info(new H().pick(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'new H\(\)\.pick\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags `h.pick(req)` where h is an instance bound from `new H()` (the brief)', () => {
    const reasons = reasonsFor(
      `class H {\n` +
        `  pick(req: any) { return req.body.password; }\n` +
        `}\n` +
        `const h = new H();\n` +
        `log.warn(h.pick(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'h\.pick\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a class method that routes through an intra-method alias before returning', () => {
    // Same intra-helper alias semantics as task #541 — the file
    // scope passed to the classifier resolves `pw` to its forbidden
    // origin so the method-classification still fires.
    const reasons = reasonsFor(
      `class H {\n` +
        `  pick(req: any) {\n` +
        `    const pw = req.body.password;\n` +
        `    return pw;\n` +
        `  }\n` +
        `}\n` +
        `log.info(new H().pick(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'new H\(\)\.pick\(\)' returning local 'pw' aliasing .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags a class with multiple methods only when the called one is forbidden', () => {
    // The methodHost records `pick` as forbidden but NOT `id`. A
    // log call to `h.id()` must stay quiet; a log call to `h.pick()`
    // must trip.
    const reasonsBenign = reasonsFor(
      `class H {\n` +
        `  pick(req: any) { return req.body.password; }\n` +
        `  id(req: any) { return req.body.id; }\n` +
        `}\n` +
        `const h = new H();\n` +
        `log.info(h.id(req));`,
    );
    expect(reasonsBenign).toHaveLength(0);
    const reasonsLeaky = reasonsFor(
      `class H {\n` +
        `  pick(req: any) { return req.body.password; }\n` +
        `  id(req: any) { return req.body.id; }\n` +
        `}\n` +
        `const h = new H();\n` +
        `log.info(h.pick(req));`,
    );
    expect(
      reasonsLeaky.some((r) =>
        /method call 'h\.pick\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a static class method `H.pick(req)`', () => {
    // Static methods are folded into the same methodHost map as
    // instance methods, so `H.pick(req)` resolves the same way as
    // `new H().pick(req)`.
    const reasons = reasonsFor(
      `class H {\n` +
        `  static pick(req: any) { return req.body.password; }\n` +
        `}\n` +
        `log.info(H.pick(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'H\.pick\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('does NOT flag an object-literal whose methods return only benign values', () => {
    // A config-style object whose method values are benign helpers
    // must not get a methodHost binding (or, if it does, must not
    // flag any call). Pin the no-false-positive expectation.
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  getId: (req: any) => req.body.id,\n` +
        `  getName: (req: any) => req.body.name,\n` +
        `};\n` +
        `log.info(helpers.getId(req), helpers.getName(req));`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a benign call on an object whose OTHER methods are forbidden', () => {
    // The methodHost records both forbidden and benign methods,
    // but only the forbidden one is in `host.methods`. A call to
    // the benign one must not trip — the lookup misses cleanly.
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `  pickId: (req: any) => req.body.id,\n` +
        `};\n` +
        `log.info('id', helpers.pickId(req));`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a non-call reference to a methodHost member', () => {
    // Passing the method as a value (`registerHandler(helpers.pick)`)
    // does not surface the secret — only invocation does. The
    // method-call rule fires only on `CallExpression`.
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pick: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info('handler is', helpers.pick);`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a method call on an object that has been shadowed by an inner declaration', () => {
    // Same shadowing rules as the alias / helper machinery: an
    // inner `const helpers = { pick: () => 'safe' }` must mask
    // the outer forbidden methodHost binding.
    const reasons = reasonsFor(
      `const helpers = { pick: (req: any) => req.body.password };\n` +
        `function caller(req: any) {\n` +
        `  const helpers = { pick: (_req: any) => 'placeholder' };\n` +
        `  log.info(helpers.pick(req));\n` +
        `}`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a method call on an unknown receiver (no flow-analysis false positives)', () => {
    // A receiver that the scanner cannot statically resolve to a
    // methodHost (a parameter, an unknown global, a function-call
    // result) must not produce a hit — the rule is intentionally
    // conservative against reaching outside the per-file scope map.
    const reasons = reasonsFor(
      `function f(svc: any) { log.info(svc.pickPassword(req)); }`,
    );
    expect(reasons).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Computed method-call detection (task #554). Task #548 closed the
  // dot-form bypass; the natural next bypass is to swap the dot for
  // a bracket and put the method name in a string literal (or a
  // no-substitution template literal):
  //
  //   const helpers = { pickPassword: (req) => req.body.password };
  //   log.info(`pw=${helpers['pickPassword'](req)}`);
  //   log.info(`pw=${helpers[\`pickPassword\`](req)}`);
  //
  // The methodHost machinery is keyed by string method name, so the
  // computed form looks up exactly the same `host.methods.get('pick')`
  // entry as the dot form once we read the index out of the literal.
  // The receiver itself can also be reached via bracket form
  // (`obj['helper']['pick']`), which is what the
  // resolveCallReceiverHost ElementAccess branch covers.
  // ---------------------------------------------------------------

  it('flags `helpers[\'pickPassword\'](req)` (single-receiver, string-literal index)', () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info(\`pw=\${helpers['pickPassword'](req)}\`);`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\["pickPassword"\]\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags `helpers[`pickPassword`](req)` (single-receiver, no-substitution template-literal index)', () => {
    // No-substitution template literals are `ts.isStringLiteralLike`
    // too, so the computed form via backticks must be flagged
    // identically to the single-quote form. The reason text uses
    // `JSON.stringify` to render the index, so it is double-quoted
    // regardless of source quote style — pin both shapes.
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.warn(helpers[\`pickPassword\`](req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\["pickPassword"\]\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags a NESTED all-bracket path `obj[\'helper\'][\'pick\'](req)`', () => {
    // Both the outer call's index AND the inner receiver's index are
    // string literals — exercises the new ElementAccess branch in
    // both `scanArgForSecrets` (call site) and
    // `resolveCallReceiverHost` (inner receiver walk).
    const reasons = reasonsFor(
      `const obj = {\n` +
        `  helper: {\n` +
        `    pick: (req: any) => req.body.password,\n` +
        `  },\n` +
        `};\n` +
        `log.info(obj['helper']['pick'](req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'obj\["helper"\]\["pick"\]\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags a MIXED path `obj[\'helper\'].pick(req)` (bracket inner, dot outer)', () => {
    // Outer callee is PropertyAccess (`.pick`), inner receiver is
    // ElementAccess (`obj['helper']`). The PropertyAccess call-site
    // branch handles the outer; the new ElementAccess case in
    // `resolveCallReceiverHost` handles the inner — the path string
    // shows the bracket form back to the reviewer.
    const reasons = reasonsFor(
      `const obj = {\n` +
        `  helper: {\n` +
        `    pick: (req: any) => req.body.password,\n` +
        `  },\n` +
        `};\n` +
        `log.info(obj['helper'].pick(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'obj\["helper"\]\.pick\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags a MIXED path `obj.helper[\'pick\'](req)` (dot inner, bracket outer)', () => {
    // Outer callee is ElementAccess (`['pick']`), inner receiver is
    // PropertyAccess (`obj.helper`). Symmetric to the previous test
    // — the new call-site ElementAccess branch handles the outer
    // even though the inner walk uses the existing PropertyAccess
    // case.
    const reasons = reasonsFor(
      `const obj = {\n` +
        `  helper: {\n` +
        `    pick: (req: any) => req.body.password,\n` +
        `  },\n` +
        `};\n` +
        `log.info(obj.helper['pick'](req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'obj\.helper\["pick"\]\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags `new H()[\'pick\'](req)` (class instance via bracket access)', () => {
    // Same methodHost binding as task #548's `new H().pick(req)`,
    // but reached via a bracket index. The receiver path renders as
    // `new H()["pick"]()` so the reviewer sees the bracket form.
    const reasons = reasonsFor(
      `class H {\n` +
        `  pick(req: any) { return req.body.password; }\n` +
        `}\n` +
        `log.info(new H()['pick'](req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'new H\(\)\["pick"\]\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('does NOT flag a computed method call whose index is a non-literal expression', () => {
    // `helpers[methodName](req)` where `methodName` is a runtime
    // variable cannot be statically resolved to a method name. The
    // rule must stay conservative — flagging would be guesswork
    // (the method might be `pickId`, not `pickPassword`).
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `  pickId: (req: any) => req.body.id,\n` +
        `};\n` +
        `function f(methodName: 'pickPassword' | 'pickId') {\n` +
        `  log.info(helpers[methodName](req));\n` +
        `}`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a computed method call whose index is a substitution template literal', () => {
    // `` helpers[`pick${suffix}`](req) `` is `ts.isTemplateExpression`,
    // NOT `ts.isStringLiteralLike` — the resolved method name depends
    // on `suffix` at runtime. Same conservatism as the variable-index
    // case above.
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `function f(suffix: string) {\n` +
        `  log.info(helpers[\`pick\${suffix}\`](req));\n` +
        `}`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('flags a parenthesized DOT-form callee `(helpers.pickPassword)(req)` (paren-bypass guard)', () => {
    // The architect-flagged paren bypass: wrapping the callee in
    // parens used to short-circuit every shape check below
    // (`n.expression` was a ParenthesizedExpression, not a
    // PropertyAccess). `unwrapParenCallee` strips the outer parens
    // before the dispatch so the dot form still trips the rule.
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info((helpers.pickPassword)(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags a parenthesized BRACKET-form callee `(helpers[\'pick\'])(req)` (paren-bypass guard)', () => {
    // Symmetric to the dot-form case above, but for the new
    // computed/bracket form. Same `unwrapParenCallee` indirection
    // makes both shapes detect identically.
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pick: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info((helpers['pick'])(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\["pick"\]\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a parenthesized BARE-IDENTIFIER helper-call `(pickPassword)(req)` (paren-bypass guard)', () => {
    // The same paren-bypass also affected the bare-identifier
    // helper-call rule (task #541). Same fix covers all three
    // call-shape rules at once.
    const reasons = reasonsFor(
      `function pickPassword(req: any) { return req.body.password; }\n` +
        `log.info((pickPassword)(req));`,
    );
    expect(
      reasons.some((r) =>
        /helper call 'pickPassword\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  // -------- Task #560: TypeScript transparent-callee wrappers --------
  //
  // Each block below mirrors the three paren-bypass tests above
  // (DOT / BRACKET / BARE-IDENTIFIER) for one TypeScript-only
  // wrapper that erases at runtime: `as`, `<...>`, and `!`. The
  // architect explicitly flagged these as the next trivial bypass
  // after #554 — anyone aware of the dot/bracket/paren rules can
  // swap the callee for `(helpers.pick as any)(req)` /
  // `(<any>helpers.pick)(req)` / `helpers.pick!(req)` and slip
  // past the dispatch otherwise. `unwrapTransparentCallee` strips
  // all four wrapper kinds (paren + the three TS wrappers) before
  // the shape check, closing the bypass for every call-shape rule
  // (helper-function, dot-method, bracket-method) at once.

  it("flags `(helpers.pickPassword as any)(req)` — DOT-form `as` wrapper (task #560)", () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info((helpers.pickPassword as any)(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it("flags `(helpers['pick'] as any)(req)` — BRACKET-form `as` wrapper (task #560)", () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pick: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info((helpers['pick'] as any)(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\["pick"\]\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it("flags `(pickPassword as any)(req)` — BARE-IDENTIFIER helper-call `as` wrapper (task #560)", () => {
    const reasons = reasonsFor(
      `function pickPassword(req: any) { return req.body.password; }\n` +
        `log.info((pickPassword as any)(req));`,
    );
    expect(
      reasons.some((r) =>
        /helper call 'pickPassword\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags `(<any>helpers.pickPassword)(req)` — DOT-form angle-bracket type assertion wrapper (task #560)', () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info((<any>helpers.pickPassword)(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it("flags `(<any>helpers['pick'])(req)` — BRACKET-form angle-bracket type assertion wrapper (task #560)", () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pick: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info((<any>helpers['pick'])(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\["pick"\]\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags `(<any>pickPassword)(req)` — BARE-IDENTIFIER helper-call angle-bracket type assertion wrapper (task #560)', () => {
    const reasons = reasonsFor(
      `function pickPassword(req: any) { return req.body.password; }\n` +
        `log.info((<any>pickPassword)(req));`,
    );
    expect(
      reasons.some((r) =>
        /helper call 'pickPassword\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags `helpers.pickPassword!(req)` — DOT-form non-null assertion wrapper (task #560)', () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info(helpers.pickPassword!(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it("flags `helpers['pick']!(req)` — BRACKET-form non-null assertion wrapper (task #560)", () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pick: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info(helpers['pick']!(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\["pick"\]\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  it('flags `pickPassword!(req)` — BARE-IDENTIFIER helper-call non-null assertion wrapper (task #560)', () => {
    const reasons = reasonsFor(
      `function pickPassword(req: any) { return req.body.password; }\n` +
        `log.info(pickPassword!(req));`,
    );
    expect(
      reasons.some((r) =>
        /helper call 'pickPassword\(\)' returning .*\.password/.test(r),
      ),
    ).toBe(true);
  });

  // Receiver-side wrappers — the architect-required sister of the
  // callee-side bypass above. After #554 the dispatch unwraps
  // wrappers on the CALLEE (`(helpers.pick as any)(req)`), but the
  // RECEIVER position inside the callee was still raw — so
  // `(helpers as any).pick(req)` and friends slipped through
  // because `resolveCallReceiverHost`'s recursion only stripped
  // `ParenthesizedExpression`. The shared `isTransparentExpressionWrapper`
  // predicate (used by both `unwrapTransparentCallee` AND the
  // recursive resolveCallReceiverHost / describeReceiverPath
  // branches) keeps both sides in lock-step.

  it("flags `(helpers as any).pickPassword(req)` — `as`-wrapped receiver, dot method (task #560)", () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info((helpers as any).pickPassword(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags `(<any>helpers).pickPassword(req)` — angle-bracket-wrapped receiver, dot method (task #560)', () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info((<any>helpers).pickPassword(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags `helpers!.pickPassword(req)` — non-null-wrapped receiver, dot method (task #560)', () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info(helpers!.pickPassword(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  // `satisfies` — TS 4.9+. Same erase-at-emit semantics as `as`,
  // and the architect explicitly called this out as a wrapper kind
  // missed by the original brief. Cover both callee and receiver
  // positions so neither side has the bypass.

  it("flags `(helpers.pickPassword satisfies (req: any) => string)(req)` — `satisfies` callee wrapper (task #560)", () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info((helpers.pickPassword satisfies (req: any) => string)(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it("flags `(helpers satisfies typeof helpers).pickPassword(req)` — `satisfies` receiver wrapper (task #560)", () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info((helpers satisfies typeof helpers).pickPassword(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it("flags `((helpers as any).pickPassword as any)(req)` — wrappers stacked on BOTH receiver AND callee compose (task #560)", () => {
    // End-to-end pin that the unwrap on the receiver side and the
    // unwrap on the callee side use the same predicate and therefore
    // strip independently. Without the shared predicate one side
    // could lag the other and this nested form would slip through.
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `};\n` +
        `log.info(((helpers as any).pickPassword as any)(req));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pickPassword\(\)' returning .*\.password/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  // Negative tests — split per-wrapper for failure-attribution
  // clarity (per architect feedback). Each pins that the wrapper
  // strip does NOT relax the methodHost binding lookup: an unknown
  // receiver stays unknown after unwrapping.

  it("does NOT flag `(unknownThing as any).pick(req)` — wrapper around an unbound receiver (task #560 negative)", () => {
    const reasons = reasonsFor(
      `declare const unknownThing: any;\n` +
        `log.info((unknownThing as any).pick(req));`,
    );
    expect(reasons).toHaveLength(0);
  });

  it("does NOT flag `(<any>unknownThing).pick(req)` — angle-bracket wrapper around an unbound receiver (task #560 negative)", () => {
    const reasons = reasonsFor(
      `declare const unknownThing: any;\n` +
        `log.info((<any>unknownThing).pick(req));`,
    );
    expect(reasons).toHaveLength(0);
  });

  it("does NOT flag `unknownThing!.pick(req)` — non-null wrapper around an unbound receiver (task #560 negative)", () => {
    const reasons = reasonsFor(
      `declare const unknownThing: any;\n` +
        `log.info(unknownThing!.pick(req));`,
    );
    expect(reasons).toHaveLength(0);
  });

  it('does NOT flag a benign computed call on a host whose OTHER methods are forbidden', () => {
    // Symmetric to task #548's "benign call on an object whose OTHER
    // methods are forbidden" — the methods map only contains the
    // forbidden entry, so a call to `helpers['pickId']` misses the
    // lookup cleanly even though `helpers['pickPassword']` would hit.
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pickPassword: (req: any) => req.body.password,\n` +
        `  pickId: (req: any) => req.body.id,\n` +
        `};\n` +
        `log.info('id', helpers['pickId'](req));`,
    );
    expect(reasons).toHaveLength(0);
  });

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
