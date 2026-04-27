/**
 * Tests the CLIENT-surface "no secret-bearing fields in log calls"
 * guard introduced in task #515.
 *
 * Companion to the server-surface test in
 * `tests/unit/check-no-secrets-in-logs.test.ts`. The shared script
 * (`scripts/check-no-secrets-in-logs.ts`) now accepts
 * `--surface=server` (default) and `--surface=client`. The client
 * surface walks `client/src/**` and `shared/**` (both `.ts` and
 * `.tsx`) and adds patterns specific to the React frontend on top of
 * the shared shapes:
 *   - property access ending in `.currentPassword` / `.newPassword`
 *     / `.confirmPassword` (the verbatim react-hook-form field names
 *     used across the change-password / set-password / admin reset
 *     flows)
 *   - bare identifier `currentPassword` / `newPassword` /
 *     `confirmPassword` in any value-reference position
 *   - bare identifier `password` in a value-reference position where
 *     it stands alone (mirroring the server's policy on `token`)
 *   - a CallExpression of `form.getValues('password')` /
 *     `form.watch('newPassword')` / `form.getFieldState('password')`
 *     — the realistic blind-spot for `console.log('attempt',
 *     form.getValues('password'))`
 *
 * Following the same shape as the server-surface test:
 *   1. Drive `scanSource` directly against synthetic source strings
 *      with `CLIENT_SURFACE` to pin down detection logic.
 *   2. Run the real CLI script ONCE via spawnSync against the real
 *      codebase in `--surface=client --strict` mode. This is the CI
 *      forcing function — `package.json` is locked so vitest is the
 *      gate.
 *   3. Run the CLI ONCE more in advisory mode against a temp fixture
 *      to pin the exit-0-with-warnings behavior on the client surface.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { scanSource, CLIENT_SURFACE } from '../../scripts/check-no-secrets-in-logs';

const SCRIPT = join(process.cwd(), 'scripts/check-no-secrets-in-logs.ts');

function reasonsFor(src: string, file = 'client/src/fixture.ts'): string[] {
  return scanSource(file, src, CLIENT_SURFACE).flatMap((h) => h.reasons);
}

describe('check-no-secrets-in-logs CI guard (client surface)', () => {
  /**
   * The real CI forcing function. Adding a new console call anywhere
   * under `client/src/` or `shared/` that interpolates
   * `data.password`, `csrfToken`, `form.getValues('password')`, etc.
   * fails this assertion.
   */
  it('runs against the real codebase in --strict mode and exits 0', () => {
    const r = spawnSync(
      'npx',
      ['tsx', SCRIPT, '--surface=client', '--strict'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'test' },
      },
    );
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(
      /no-secrets-in-logs guard \(client\): scanned \d+ file\(s\) — OK/,
    );
  });

  // ---------------------------------------------------------------
  // Shared shapes also flagged by the server surface — verified here
  // to pin that the client config preserves them (catches future
  // regressions where someone trims the client set in isolation).
  // ---------------------------------------------------------------

  it('flags console.log with body.password (shared property-access shape)', () => {
    expect(reasonsFor(`console.log('login', { pw: data.password });`)).toContain(
      'property access ending in .password',
    );
  });

  it('flags bare csrfToken in a template interpolation (shared identifier shape)', () => {
    expect(
      reasonsFor(
        `function f(csrfToken: string) { console.warn(\`ct=\${csrfToken}\`); }`,
      ),
    ).toContain("bare identifier 'csrfToken'");
  });

  it("flags element access with 'x-csrf-token' header literal (shared header shape)", () => {
    expect(
      reasonsFor(
        `console.warn(\`hdr=\${headers['x-csrf-token']}\`);`,
      ),
    ).toContain('element access ["x-csrf-token"]');
  });

  // ---------------------------------------------------------------
  // Client-only password-field property access. The change-password,
  // set-password, and admin reset-password flows all use these field
  // names verbatim on the react-hook-form controlled object.
  // ---------------------------------------------------------------

  it('flags property access ending in .currentPassword / .newPassword / .confirmPassword', () => {
    expect(
      reasonsFor(`console.log(\`pw=\${data.currentPassword}\`);`),
    ).toContain('property access ending in .currentPassword');
    expect(reasonsFor(`console.log('np', { v: data.newPassword });`)).toContain(
      'property access ending in .newPassword',
    );
    expect(
      reasonsFor(`console.log(\`cp=\${data.confirmPassword}\`);`),
    ).toContain('property access ending in .confirmPassword');
  });

  it('flags bare currentPassword / newPassword / confirmPassword identifiers', () => {
    expect(
      reasonsFor(
        `function f(currentPassword: string) { console.log(\`cp=\${currentPassword}\`); }`,
      ),
    ).toContain("bare identifier 'currentPassword'");
    expect(
      reasonsFor(
        `function f(newPassword: string) { console.log(\`np=\${newPassword}\`); }`,
      ),
    ).toContain("bare identifier 'newPassword'");
    expect(
      reasonsFor(
        `function f(confirmPassword: string) { console.log(\`cp=\${confirmPassword}\`); }`,
      ),
    ).toContain("bare identifier 'confirmPassword'");
  });

  it('flags shorthand `{ newPassword }` (the destructure-then-log shape)', () => {
    const reasons = reasonsFor(
      `function f() {\n` +
        `  const { newPassword } = data;\n` +
        `  console.log('attempt', { newPassword });\n` +
        `}`,
    );
    expect(reasons.some((r) => /shorthand property 'newPassword'/.test(r))).toBe(
      true,
    );
  });

  // ---------------------------------------------------------------
  // Bare `password` policy: same shape as the server's `token`
  // policy — flagged in value-reference positions, not as a
  // property-access receiver. Property-access of `.password` is
  // still caught by the shared rule.
  // ---------------------------------------------------------------

  it('flags shorthand `{ password }` (the realistic destructure-then-log blind spot)', () => {
    const reasons = reasonsFor(
      `function f() {\n` +
        `  const { password } = form.getValues();\n` +
        `  console.log('attempt', { password });\n` +
        `}`,
    );
    expect(reasons.some((r) => /shorthand property 'password'/.test(r))).toBe(
      true,
    );
  });

  it('flags bare `password` interpolated into a template / passed as a direct argument', () => {
    expect(
      reasonsFor(
        `function f(password: string) { console.log(\`pw=\${password}\`); }`,
      ),
    ).toContain("bare identifier 'password'");
    expect(
      reasonsFor(
        `function f(password: string) { console.warn('seen', password); }`,
      ),
    ).toContain("bare identifier 'password'");
  });

  it('does NOT flag bare `password` when it is the receiver of a property access', () => {
    // `password.length` is metadata (length check) — the actual
    // password bytes are not in the log line. The property-access
    // rule still catches `data.password` directly.
    expect(
      reasonsFor(
        `function f(password: string) { console.log('len', { len: password.length }); }`,
      ),
    ).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // react-hook-form value-reader detection (`form.getValues(...)` /
  // `form.watch(...)` / `form.getFieldState(...)`). This is the
  // brief's headline blind spot.
  // ---------------------------------------------------------------

  it("flags console.log(form.getValues('password'))", () => {
    expect(
      reasonsFor(`console.log('attempt', form.getValues('password'));`),
    ).toContain('form-reader call .getValues("password")');
  });

  it("flags console.warn with form.watch('newPassword') in a template", () => {
    expect(
      reasonsFor(`console.warn(\`val=\${form.watch('newPassword')}\`);`),
    ).toContain('form-reader call .watch("newPassword")');
  });

  it("flags form.getValues for currentPassword / confirmPassword / token / csrfToken keys", () => {
    expect(
      reasonsFor(`console.log(form.getValues('currentPassword'));`),
    ).toContain('form-reader call .getValues("currentPassword")');
    expect(
      reasonsFor(`console.log(form.getValues('confirmPassword'));`),
    ).toContain('form-reader call .getValues("confirmPassword")');
    expect(reasonsFor(`console.log(form.getValues('token'));`)).toContain(
      'form-reader call .getValues("token")',
    );
    expect(reasonsFor(`console.log(form.getValues('csrfToken'));`)).toContain(
      'form-reader call .getValues("csrfToken")',
    );
  });

  it("flags form.getFieldState for a forbidden field (symmetry — flagged even though it returns metadata)", () => {
    // getFieldState returns { invalid, isDirty, isTouched, error } —
    // not the value bytes — but the pattern is still review-worthy
    // and trivial to misuse, so the guard flags it. If a legitimate
    // case appears, suppress it with a `secret-log-ok` annotation.
    expect(
      reasonsFor(`console.log(form.getFieldState('password'));`),
    ).toContain('form-reader call .getFieldState("password")');
  });

  it("does NOT flag form.getValues / form.watch on benign field names", () => {
    // `form.getValues('amount')`, `form.watch('type')` etc. are the
    // pattern across the payment forms — they must not trip.
    expect(reasonsFor(`console.log(form.getValues('amount'));`)).toHaveLength(0);
    expect(reasonsFor(`console.log(form.watch('type'));`)).toHaveLength(0);
    expect(
      reasonsFor(`console.log(form.getValues('bowlerId'));`),
    ).toHaveLength(0);
  });

  it('does NOT flag a non-form call that happens to mention a forbidden key as a string', () => {
    // The form-reader rule only flags methods listed in
    // `forbiddenFormGetterMethods` (`getValues` / `watch` /
    // `getFieldState`). A different method name with the same string
    // arg is not in scope.
    expect(
      reasonsFor(`console.log(translate('password'));`),
    ).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // .tsx scanning — the client surface walks both .ts and .tsx,
  // and JSX in the source must not break the parse.
  // ---------------------------------------------------------------

  it('parses .tsx source without choking on JSX and still flags inline console leaks', () => {
    const src =
      `function Card({ password }: { password: string }) {\n` +
      `  console.log('mount', { password });\n` +
      `  return <div className="card">hi</div>;\n` +
      `}`;
    const reasons = reasonsFor(src, 'client/src/components/fixture.tsx');
    expect(reasons.some((r) => /shorthand property 'password'/.test(r))).toBe(
      true,
    );
  });

  it('does NOT flag JSX attribute name="password" (string-literal value, not a value reference)', () => {
    // The scanner only inspects expression nodes. A JSX attribute
    // value like `<input type="password" />` or
    // `<input name="newPassword" />` is a string-literal value, never
    // examined.
    const src =
      `function F() {\n` +
      `  console.log('render');\n` +
      `  return <input type="password" name="newPassword" />;\n` +
      `}`;
    expect(reasonsFor(src, 'client/src/components/fixture.tsx')).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Negative cases shared with the server surface — pinned here
  // explicitly because the client config is its own object.
  // ---------------------------------------------------------------

  it('does NOT flag structural labels in string literals (no value reference)', () => {
    expect(
      reasonsFor(`console.warn('csrfToken missing for request');`),
    ).toHaveLength(0);
    expect(
      reasonsFor(`console.log(\`newPassword issued for user \${user.id}\`);`),
    ).toHaveLength(0);
  });

  it('does NOT flag property NAMES in object-literal keys (only values count)', () => {
    expect(reasonsFor(`console.log('safe', { password: 'X' });`)).toHaveLength(
      0,
    );
    expect(
      reasonsFor(`console.log('safe', { newPassword: 'X' });`),
    ).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Helper-function call detection (task #541) on the client
  // surface. Same machinery as the server surface but the
  // forbidden-shape sets are wider — a helper that returns
  // `data.newPassword` or `form.getValues('password')` must be
  // recognized too, since those are the canonical client-only
  // forbidden shapes.
  // ---------------------------------------------------------------

  it('flags a helper that returns .currentPassword (client-only forbidden property)', () => {
    const reasons = reasonsFor(
      `function pickPw(d: any) { return d.currentPassword; }\n` +
        `console.log(\`pw=\${pickPw(data)}\`);`,
    );
    expect(
      reasons.some((r) =>
        /helper call 'pickPw\(\)' returning .*\.currentPassword/.test(r),
      ),
    ).toBe(true);
  });

  it("flags a helper that returns form.getValues('password') (client-only form-reader)", () => {
    // The helper-classifier reuses the form-reader detection on
    // its return-statement expression — `return form.getValues(...)`
    // with a forbidden field key classifies the helper as forbidden.
    const reasons = reasonsFor(
      `const pickPw = (form: any) => form.getValues('password');\n` +
        `console.warn(\`v=\${pickPw(form)}\`);`,
    );
    expect(
      reasons.some((r) =>
        /helper call 'pickPw\(\)' returning form-reader call \.getValues\("password"\)/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('does NOT flag a helper that returns a benign field', () => {
    expect(
      reasonsFor(
        `function pickAmount(d: any) { return d.amount; }\n` +
          `console.log(pickAmount(data));`,
      ),
    ).toHaveLength(0);
  });

  it('flags a CROSS-FILE helper imported from a sibling .ts file (client surface)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-client-cross-'));
    const helpersFile = join(dir, 'client/src/helpers.ts');
    const componentFile = join(dir, 'client/src/Component.tsx');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export const pickPw = (d: any) => d.newPassword;\n`,
    );
    writeFileSync(
      componentFile,
      `import { pickPw } from './helpers';\n` +
        `function F({ data }: any) {\n` +
        `  console.log('attempt', pickPw(data));\n` +
        `  return null;\n` +
        `}\n`,
    );
    const reasons = scanSource(
      componentFile,
      readFileSync(componentFile, 'utf8'),
      CLIENT_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /helper call 'pickPw\(\)' returning .*\.newPassword/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE default-exported helper imported via default-import (client surface, task #549)', () => {
    // Same default-export / default-import shape as the server
    // surface, pinned on the client so the wider client forbidden
    // sets (`newPassword` etc.) also flow through the default-import
    // resolver.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-client-cross-default-'),
    );
    const helpersFile = join(dir, 'client/src/helpers.ts');
    const componentFile = join(dir, 'client/src/Component.tsx');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export default (d: any) => d.newPassword;\n`,
    );
    writeFileSync(
      componentFile,
      `import grabPw from './helpers';\n` +
        `function F({ data }: any) {\n` +
        `  console.log('attempt', grabPw(data));\n` +
        `  return null;\n` +
        `}\n`,
    );
    const reasons = scanSource(
      componentFile,
      readFileSync(componentFile, 'utf8'),
      CLIENT_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /helper call 'grabPw\(\)' returning .*\.newPassword/.test(r),
      ),
    ).toBe(true);
  });

  // ---------------------------------------------------------------
  // Method-call detection (task #548) on the client surface. Same
  // machinery as the server surface but the forbidden-shape sets
  // are wider — a method that returns `data.newPassword` or
  // `form.getValues('password')` must classify the host as forbidden
  // for that method name.
  // ---------------------------------------------------------------

  it('flags `helpers.pick(data)` where helpers is an object literal returning .newPassword', () => {
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pick: (d: any) => d.newPassword,\n` +
        `};\n` +
        `console.log(\`pw=\${helpers.pick(data)}\`);`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pick\(\)' returning .*\.newPassword/.test(r),
      ),
    ).toBe(true);
  });

  it("flags `helpers.pick(form)` whose method returns form.getValues('password')", () => {
    // Reuses the form-reader detection in the method-classifier:
    // the method body returns `form.getValues('password')`, which
    // classifies the method as forbidden so any call to it inside
    // a log argument is flagged.
    const reasons = reasonsFor(
      `const helpers = {\n` +
        `  pick: (form: any) => form.getValues('password'),\n` +
        `};\n` +
        `console.warn(\`v=\${helpers.pick(form)}\`);`,
    );
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pick\(\)' returning form-reader call \.getValues\("password"\)/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE named-export object literal `import { helpers } from … ; helpers.pick(data)` (task #553)', () => {
    // Same cross-file methodHost shape as the server test, pinned
    // on the client surface so the wider client forbidden-shape set
    // (`.newPassword` etc.) routes through `getExportedHelpers`.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-client-cross-host-obj-'),
    );
    const helpersFile = join(dir, 'client/src/helpers.ts');
    const componentFile = join(dir, 'client/src/Component.tsx');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export const helpers = {\n` +
        `  pick: (d: any) => d.newPassword,\n` +
        `};\n`,
    );
    writeFileSync(
      componentFile,
      `import { helpers } from './helpers';\n` +
        `function F({ data }: any) {\n` +
        `  console.log('attempt', helpers.pick(data));\n` +
        `  return null;\n` +
        `}\n`,
    );
    const reasons = scanSource(
      componentFile,
      readFileSync(componentFile, 'utf8'),
      CLIENT_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'helpers\.pick\(\)' returning .*\.newPassword/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a CROSS-FILE named-export class `import { H } from … ; const h = new H(); h.pick(data)` (task #553)', () => {
    // The instance-binding pass must run AFTER cross-file imports
    // so the imported `H` is in scope by the time `new H()` is
    // resolved into the methodHost binding for `h`.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-client-cross-host-class-'),
    );
    const helpersFile = join(dir, 'client/src/helpers.ts');
    const componentFile = join(dir, 'client/src/Component.tsx');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export class H {\n` +
        `  pick(d: any) { return d.newPassword; }\n` +
        `}\n`,
    );
    writeFileSync(
      componentFile,
      `import { H } from './helpers';\n` +
        `function F({ data }: any) {\n` +
        `  const h = new H();\n` +
        `  console.warn('v=', h.pick(data));\n` +
        `  return null;\n` +
        `}\n`,
    );
    const reasons = scanSource(
      componentFile,
      readFileSync(componentFile, 'utf8'),
      CLIENT_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'h\.pick\(\)' returning .*\.newPassword/.test(r),
      ),
    ).toBe(true);
  });

  it('flags `new H().pick(data)` on the client surface', () => {
    const reasons = reasonsFor(
      `class H {\n` +
        `  pick(d: any) { return d.newPassword; }\n` +
        `}\n` +
        `console.log(new H().pick(data));`,
    );
    expect(
      reasons.some((r) =>
        /method call 'new H\(\)\.pick\(\)' returning .*\.newPassword/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a NAMESPACE-IMPORT nested object-literal `mod.helpers.pickPassword(data)` on the client surface (task #558)', () => {
    // Client-surface parity for the server-side namespace-import
    // tests in `check-no-secrets-in-logs.test.ts`. The detection
    // logic is shared, but pinning the client surface here prevents
    // future client-only forbidden-property additions (e.g.
    // `newPassword`) from silently regressing the namespace path.
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-client-ns-obj-'),
    );
    const helpersFile = join(dir, 'client/src/helpers.ts');
    const componentFile = join(dir, 'client/src/Component.tsx');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export const helpers = {\n` +
        `  pickPassword: (d: any) => d.newPassword,\n` +
        `};\n`,
    );
    writeFileSync(
      componentFile,
      `import * as mod from './helpers';\n` +
        `function F({ data }: any) {\n` +
        `  console.log('v=', mod.helpers.pickPassword(data));\n` +
        `  return null;\n` +
        `}\n`,
    );
    const reasons = scanSource(
      componentFile,
      readFileSync(componentFile, 'utf8'),
      CLIENT_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'mod\.helpers\.pickPassword\(\)' returning .*\.newPassword/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  it('flags a NAMESPACE-IMPORT nested class via `new mod.H().pick(data)` on the client surface (task #558)', () => {
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-client-ns-class-'),
    );
    const helpersFile = join(dir, 'client/src/helpers.ts');
    const componentFile = join(dir, 'client/src/Component.tsx');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export class H {\n` +
        `  pick(d: any) { return d.newPassword; }\n` +
        `}\n`,
    );
    writeFileSync(
      componentFile,
      `import * as mod from './helpers';\n` +
        `function F({ data }: any) {\n` +
        `  console.warn(new mod.H().pick(data));\n` +
        `  return null;\n` +
        `}\n`,
    );
    const reasons = scanSource(
      componentFile,
      readFileSync(componentFile, 'utf8'),
      CLIENT_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'new mod\.H\(\)\.pick\(\)' returning .*\.newPassword/.test(
          r,
        ),
      ),
    ).toBe(true);
  });

  // ---------------------------------------------------------------
  // Default-exported method hosts on the client (task #559) — parity
  // with the server-surface tests of the same task. The exporter
  // helper map handling is surface-agnostic, but the client surface
  // intentionally exercises a different forbidden source field
  // (`data.newPassword`) so a regression on either surface fails
  // independently of the other.
  // ---------------------------------------------------------------

  it('flags a DEFAULT-export class via `import H from … ; new H().pick(data)` on the client surface (task #559)', () => {
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-client-default-host-class-'),
    );
    const helpersFile = join(dir, 'client/src/helpers.ts');
    const componentFile = join(dir, 'client/src/component.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export default class H {\n` +
        `  pick(data: any) { return data.newPassword; }\n` +
        `}\n`,
    );
    writeFileSync(
      componentFile,
      `import H from './helpers';\n` +
        `function f(data: any) { console.log(new H().pick(data)); }\n`,
    );
    const reasons = scanSource(
      componentFile,
      readFileSync(componentFile, 'utf8'),
      CLIENT_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'new H\(\)\.pick\(\)' returning .*\.newPassword/.test(r),
      ),
    ).toBe(true);
  });

  it('flags a DEFAULT-export object literal via `import obj from … ; obj.pick(data)` on the client surface (task #559)', () => {
    const dir = mkdtempSync(
      join(tmpdir(), 'no-secrets-in-logs-client-default-host-obj-'),
    );
    const helpersFile = join(dir, 'client/src/helpers.ts');
    const componentFile = join(dir, 'client/src/component.ts');
    mkdirSync(dirname(helpersFile), { recursive: true });
    writeFileSync(
      helpersFile,
      `export default {\n` +
        `  pick: (data: any) => data.newPassword,\n` +
        `};\n`,
    );
    writeFileSync(
      componentFile,
      `import obj from './helpers';\n` +
        `function f(data: any) { console.log(obj.pick(data)); }\n`,
    );
    const reasons = scanSource(
      componentFile,
      readFileSync(componentFile, 'utf8'),
      CLIENT_SURFACE,
    ).flatMap((h) => h.reasons);
    expect(
      reasons.some((r) =>
        /method call 'obj\.pick\(\)' returning .*\.newPassword/.test(r),
      ),
    ).toBe(true);
  });

  // ---------------------------------------------------------------
  // Suppression annotation works on the client surface too.
  // ---------------------------------------------------------------

  it('honors a trailing // secret-log-ok: <reason> annotation on the client surface', () => {
    const reasons = reasonsFor(
      `function f(csrfToken: string) {\n` +
        `  console.warn(\`csrfToken=\${csrfToken}\`); // secret-log-ok: client test fixture\n` +
        `}`,
    );
    expect(reasons).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // CLI behavior: advisory mode against a fixture under client/src.
  // ---------------------------------------------------------------

  it('exits 0 in advisory mode (no --strict) on the client surface even when violations exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-secrets-in-logs-client-advisory-'));
    const file = join(dir, 'client/src/foo.tsx');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `function F({ password }: { password: string }) {\n` +
        `  console.log('hi', { password });\n` +
        `  return <span>x</span>;\n` +
        `}\n`,
    );
    const r = spawnSync('npx', ['tsx', SCRIPT, '--surface=client'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARN.*shorthand property 'password'/);
  });
});
