/**
 * Tests the trust-proxy coverage CI guard introduced in task #378.
 *
 * The guard (`scripts/check-trust-proxy-coverage.ts`) walks every
 * `.ts` file under `server/` and fails if any `express()` invocation
 * sits in a file that doesn't also call `assertTrustProxyAtBoot`. It
 * exists so a future entrypoint (a worker that also serves HTTP, a
 * serverless adapter, etc.) can't silently introduce a second
 * `express()` instance without the boot-time trust-proxy check —
 * that would let per-IP rate limiters key off the proxy's loopback
 * address and quietly collapse the brute-force ceiling. See
 * `server/lib/trust-proxy-check.ts` for the full rationale.
 *
 * These tests:
 *   1. Run the real script against the real `server/` tree (clean
 *      spawn) and assert it currently exits 0.
 *   2. Run the script against synthetic fixtures covering the
 *      positive, negative, comment-stripping, and test-skip paths.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts/check-trust-proxy-coverage.ts');
// Resolve the local tsx CLI directly. Going through `npx tsx` adds a
// stale-cache failure mode (the `_npx` shim has gone missing in this
// container at least once) and isn't needed: tsx is in the project's
// own node_modules.
const TSX_CLI = join(process.cwd(), 'node_modules/tsx/dist/cli.mjs');

function runIn(cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [TSX_CLI, SCRIPT], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'trust-proxy-check-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

describe('check-trust-proxy-coverage CI guard', () => {
  it('passes against the real server/ tree (sanity)', () => {
    const r = runIn(process.cwd());
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/OK/);
  });

  it('fails when an express() instance has no assertTrustProxyAtBoot call in the same file', () => {
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
const app = express();
app.set('trust proxy', 1);
// missing: assertTrustProxyAtBoot call
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/index\.ts/);
    expect(r.stderr).toMatch(/express\(\) without assertTrustProxyAtBoot/);
  });

  it('fails for any new entrypoint file under server/, not just index.ts', () => {
    // The whole point of the guard: catches a future contributor
    // who spins up a second express() somewhere other than the
    // canonical entrypoint (e.g. an admin UI, a worker that also
    // serves HTTP, a serverless adapter).
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import { assertTrustProxyAtBoot } from './lib/trust-proxy-check';
const app = express();
app.set('trust proxy', 1);
assertTrustProxyAtBoot(app, { isProduction: false, log: console });
`,
      'server/admin-app.ts': `import express from 'express';
const adminApp = express();
adminApp.set('trust proxy', 1);
// oops — forgot the boot-time guard
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/admin-app\.ts/);
    // index.ts is fine here, must NOT be flagged.
    expect(r.stderr).not.toMatch(/server\/index\.ts/);
  });

  it('passes when the new entrypoint imports and calls the assertion', () => {
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import { assertTrustProxyAtBoot } from './lib/trust-proxy-check';
const app = express();
app.set('trust proxy', 1);
assertTrustProxyAtBoot(app, { isProduction: false, log: console });
`,
      'server/admin-app.ts': `import express from 'express';
import { assertTrustProxyAtBoot } from './lib/trust-proxy-check';
const adminApp = express();
adminApp.set('trust proxy', 1);
assertTrustProxyAtBoot(adminApp, { isProduction: true, log: console });
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('does not flag commented-out express() calls', () => {
    const dir = makeFixture({
      'server/sample.ts': `// const app = express();   // example in a doc comment
/* express() */
export const note = 1;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('does not flag commented-out express() calls inside doc comments', () => {
    // Block-comment doc snippets that mention express() must be
    // stripped before the regex pass.
    const dir = makeFixture({
      'server/sample.ts': `/**
 * Example usage:
 *   const app = express();
 *   app.use(stuff);
 */
export const note = 2;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('skips files under __tests__ directories', () => {
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import { assertTrustProxyAtBoot } from './lib/trust-proxy-check';
const app = express();
assertTrustProxyAtBoot(app, { isProduction: false, log: console });
`,
      'server/__tests__/fixture.ts': `import express from 'express';
const fakeApp = express();
// no assertion here — but this is a test fixture, must be skipped
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('skips *.test.ts files', () => {
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import { assertTrustProxyAtBoot } from './lib/trust-proxy-check';
const app = express();
assertTrustProxyAtBoot(app, { isProduction: false, log: console });
`,
      'server/something.test.ts': `import express from 'express';
const fakeApp = express();
// no assertion here — but this is a test file, must be skipped
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('does not match property-style calls like obj.express()', () => {
    // The regex is pinned to a bare `express()` call so a property
    // access on something named `express` doesn't trip the guard.
    const dir = makeFixture({
      'server/sample.ts': `import { someLib } from 'somewhere';
someLib.express();
const myExpress = { express: () => 0 };
myExpress.express();
export const note = 3;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('does not flag the import line itself', () => {
    // `import express from 'express'` must not match the regex.
    const dir = makeFixture({
      'server/sample.ts': `import express from 'express';
export const note = 4;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('flags a renamed default import (import ex from "express"; ex())', () => {
    // The realistic future-contributor footgun: rename the default
    // import and a regex pinned to the literal token `express()`
    // would silently miss the new app instance. The script must
    // follow the binding.
    const dir = makeFixture({
      'server/admin-app.ts': `import ex from 'express';
const adminApp = ex();
adminApp.set('trust proxy', 1);
// no assertion — must be flagged
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/admin-app\.ts/);
  });

  it('passes a renamed default import when the assertion is present', () => {
    const dir = makeFixture({
      'server/admin-app.ts': `import ex from 'express';
import { assertTrustProxyAtBoot } from './lib/trust-proxy-check';
const adminApp = ex();
adminApp.set('trust proxy', 1);
assertTrustProxyAtBoot(adminApp, { isProduction: false, log: console });
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('flags an ESM default + named import alias (import ex, { Router } from "express"; ex())', () => {
    // `import express, { Router } from 'express'` is the real shape
    // server/index.ts uses; the regex must still recognize the
    // default-binding name when a named-import tail is present.
    // Renamed variant is the dangerous one.
    const dir = makeFixture({
      'server/admin-app.ts': `import ex, { Router } from 'express';
const adminApp = ex();
const r = Router();
`,
    });
    const result = runIn(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/server\/admin-app\.ts/);
  });

  it('flags a CJS default require (const ex = require("express"); ex())', () => {
    const dir = makeFixture({
      'server/admin-app.ts': `const ex = require('express');
const adminApp = ex();
adminApp.set('trust proxy', 1);
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/admin-app\.ts/);
  });

  it('flags a CJS destructured default require (const { default: ex } = require("express"); ex())', () => {
    const dir = makeFixture({
      'server/admin-app.ts': `const { default: ex } = require('express');
const adminApp = ex();
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/admin-app\.ts/);
  });

  it('flags an ESM namespace import using the .default constructor (import * as ex from "express"; ex.default())', () => {
    const dir = makeFixture({
      'server/admin-app.ts': `import * as ex from 'express';
const adminApp = ex.default();
adminApp.set('trust proxy', 1);
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/admin-app\.ts/);
  });

  it('does not flag a file that imports express but never calls it (e.g. only uses Router)', () => {
    // A file might import the default just to grab `Router` from
    // the same statement, or to re-export types, without ever
    // constructing an app. No call site → nothing to flag.
    const dir = makeFixture({
      'server/sample.ts': `import express, { Router } from 'express';
const r = Router();
export { r };
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('flags multiple express() calls in the same uncovered file separately', () => {
    // If a file unfortunately has two express() instances, both
    // line numbers should appear so the violation report is useful
    // to the dev fixing it.
    const dir = makeFixture({
      'server/sample.ts': `import express from 'express';
const app = express();
const adminApp = express();
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/sample\.ts:2/);
    expect(r.stderr).toMatch(/server\/sample\.ts:3/);
  });
});
