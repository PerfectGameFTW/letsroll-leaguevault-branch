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
 * Coverage is one positive + one negative per detection bucket:
 *   - presence check (default import + new entrypoint)
 *   - comment / non-call false-positive avoidance
 *   - test/fixture skip path
 *   - alias-following (renamed default import)
 *   - CJS require + ESM namespace .default()
 *   - position check: assertion must precede listen()
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
  // ---- presence check: positive + negative -----------------------
  it('fails when an express() instance has no assertTrustProxyAtBoot call in the same file', () => {
    const dir = makeFixture({
      'server/admin-app.ts': `import express from 'express';
const adminApp = express();
adminApp.set('trust proxy', 1);
// missing: assertTrustProxyAtBoot call
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/admin-app\.ts/);
    expect(r.stderr).toMatch(/express\(\) without assertTrustProxyAtBoot/);
  });

  it('passes when the new entrypoint imports and calls the assertion', () => {
    const dir = makeFixture({
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

  // ---- comment / non-call false positives ------------------------
  it('does not flag commented-out, doc-comment, or property-style express() references', () => {
    const dir = makeFixture({
      'server/sample.ts': `// const app = express();   // line-comment example
/**
 * Example usage:
 *   const app = express();
 */
import { someLib } from 'somewhere';
someLib.express();
const myExpress = { express: () => 0 };
myExpress.express();
export const note = 1;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  // ---- test / fixture skip path ----------------------------------
  it('skips files under __tests__ directories and *.test.ts files', () => {
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
      'server/something.test.ts': `import express from 'express';
const fakeAppToo = express();
// no assertion here — but this is a test file, must be skipped
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  // ---- alias-following: renamed default import -------------------
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

  // ---- CJS require + ESM namespace .default() --------------------
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

  // ---- position check: assertion-vs-listen ordering --------------
  // The lint additionally rejects files where the first
  // `assertTrustProxyAtBoot(` call site appears at a later source
  // offset than the first `<id>.listen(` call. This closes the
  // residual gap left open by the original presence-only check: a
  // future entrypoint could legally call the assertion AFTER
  // `app.listen(...)`, satisfying the presence check while letting
  // a real request arrive (and key off a misconfigured `req.ip`)
  // before the boot-time guard ever runs.
  it('passes when the assertion appears before the first listen() call', () => {
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import { assertTrustProxyAtBoot } from './lib/trust-proxy-check';
const app = express();
app.set('trust proxy', 1);
assertTrustProxyAtBoot(app, { isProduction: false, log: console });
app.listen(3000);
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('fails when the assertion is placed after app.listen()', () => {
    // The exact footgun the position check exists to catch:
    // presence check passes, but `app.listen()` has already started
    // accepting connections by the time the assertion would have
    // run.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import { assertTrustProxyAtBoot } from './lib/trust-proxy-check';
const app = express();
app.set('trust proxy', 1);
app.listen(3000);
assertTrustProxyAtBoot(app, { isProduction: false, log: console });
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/server\/index\.ts:6/);
    expect(r.stderr).toMatch(/after listen\(\) at line 5/);
  });

  it('matches the real server/index.ts factoring (top-level assertion, listen inside a startServer()) and passes', () => {
    // Mirrors the real entrypoint: the assertion is at top level
    // right after `app.set('trust proxy')`, and `server.listen(...)`
    // lives further down inside an async startServer() body. The
    // position check must accept this regardless of where
    // startServer() is invoked from.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import { createServer } from 'http';
import { assertTrustProxyAtBoot } from './lib/trust-proxy-check';
const app = express();
app.set('trust proxy', 1);
assertTrustProxyAtBoot(app, { isProduction: false, log: console });
const server = createServer(app);
async function startServer() {
  server.listen({ port: 3000, host: '0.0.0.0' });
}
startServer();
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });
});
