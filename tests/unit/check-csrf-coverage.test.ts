/**
 * Tests the CSRF coverage CI guard introduced in task #308 and
 * extended in task #338.
 *
 * The guard (`scripts/check-csrf-coverage.ts`) walks every `.ts` file
 * under `server/` and fails if any state-changing route — whether
 * mounted directly via `app.<method>(...)` or transitively via
 * `app.use('<prefix>', <importedRouter>)` plus `router.<method>(...)`
 * inside the imported router file — has an effective path outside
 * `/api/` without an explicit allowlist entry.
 *
 * These tests:
 *   1. Run the real script against the real `server/` tree (via a
 *      clean spawn) and assert it currently exits 0.
 *   2. Run the real script against synthetic fixtures covering both
 *      the direct-on-app violation and the sub-router violation.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts/check-csrf-coverage.ts');

function runIn(cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('npx', ['tsx', SCRIPT], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Build a synthetic fixture directory. `files` maps relative paths
 * (inside the fixture) to file contents. The fixture always lives
 * under a fresh tmpdir so each test is isolated.
 */
function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'csrf-check-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

function makeIndexFixture(indexContents: string): string {
  return makeFixture({ 'server/index.ts': indexContents });
}

describe('check-csrf-coverage CI guard', () => {
  it('passes against the real server/ tree (sanity)', () => {
    const r = runIn(process.cwd());
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/OK/);
  });

  it('fails when a state-changing route is mounted directly on app outside /api', () => {
    const dir = makeIndexFixture(
      `import express from 'express';
const app = express();
app.post('/foo', (req, res) => res.sendStatus(200));
app.use('/api', csrfProtection);
`,
    );
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/POST \/foo/);
  });

  it.each(['post', 'put', 'patch', 'delete'])(
    'flags app.%s on a non-/api path',
    (method) => {
      const dir = makeIndexFixture(
        `import express from 'express';
const app = express();
app.${method}('/sneaky', (req, res) => res.sendStatus(200));
`,
      );
      const r = runIn(dir);
      expect(r.status).toBe(1);
      expect(r.stderr.toUpperCase()).toContain(`${method.toUpperCase()} /SNEAKY`);
    },
  );

  it('does not flag app.post mounted under /api', () => {
    const dir = makeIndexFixture(
      `import express from 'express';
const app = express();
app.post('/api/teams', (req, res) => res.sendStatus(200));
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('does not flag app.get on non-/api paths (GET is not state-changing)', () => {
    const dir = makeIndexFixture(
      `import express from 'express';
const app = express();
app.get('/.well-known/whatever', (req, res) => res.sendStatus(200));
app.get('/manifest.json', (req, res) => res.sendStatus(200));
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('does not flag commented-out app.post calls', () => {
    const dir = makeIndexFixture(
      `import express from 'express';
const app = express();
// app.post('/foo', handler);  // commented out
/* app.post('/bar', handler); */
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('flags a sub-router file mounted at a non-/api prefix', () => {
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import sneakyRouter from './routes/sneaky.js';
const app = express();
app.use('/foo', sneakyRouter);
app.use('/api', csrfProtection);
`,
      'server/routes/sneaky.ts': `import { Router } from 'express';
const router = Router();
router.post('/bar', (req, res) => res.sendStatus(200));
router.delete('/baz', (req, res) => res.sendStatus(200));
export default router;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/POST \/foo\/bar/);
    expect(r.stderr).toMatch(/DELETE \/foo\/baz/);
    expect(r.stderr).toMatch(/sneaky\.ts/);
  });

  it('does not flag a sub-router file mounted under /api', () => {
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import goodRouter from './routes/good.js';
const app = express();
app.use('/api/good', goodRouter);
`,
      'server/routes/good.ts': `import { Router } from 'express';
const router = Router();
router.post('/things', (req, res) => res.sendStatus(200));
router.patch('/things/:id', (req, res) => res.sendStatus(200));
export default router;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('flags a router defined and mounted in the same file at a non-/api prefix', () => {
    // Real codebase pattern: a single file declares
    // `const authRouter = Router(); authRouter.post(...); app.use('/api/auth', authRouter);`
    // The previous version of the guard only resolved imported
    // routers, so a same-file Router var mounted at non-/api would
    // silently bypass CSRF. This test pins down that gap.
    const dir = makeIndexFixture(
      `import express, { Router } from 'express';
const app = express();
const sneakyRouter = Router();
sneakyRouter.post('/bar', (req, res) => res.sendStatus(200));
sneakyRouter.patch('/baz/:id', (req, res) => res.sendStatus(200));
app.use('/foo', sneakyRouter);
app.use('/api', csrfProtection);
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/POST \/foo\/bar/);
    expect(r.stderr).toMatch(/PATCH \/foo\/baz\/:id/);
  });

  it('does not flag a same-file router mounted under /api', () => {
    const dir = makeIndexFixture(
      `import express, { Router } from 'express';
const app = express();
const goodRouter = Router();
goodRouter.post('/things', (req, res) => res.sendStatus(200));
app.use('/api/good', goodRouter);
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('flags a nested sub-router composed inside a parent that has no direct routes (task #397)', () => {
    // The exact regression this task targets: parent router lives at
    // /foo and has NO direct routes of its own — its only role is to
    // compose a child via `router.use('/sub', child)`. Before #397,
    // there was no `parent.<method>` call to trip the guard, so the
    // mistake of mounting the parent at non-/api would slip through.
    // After #397, the child file's effective prefix is computed
    // transitively as /foo + /sub, so its post('/x') is flagged at
    // /foo/sub/x.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import parentRouter from './routes/parent.js';
const app = express();
app.use('/foo', parentRouter);
app.use('/api', csrfProtection);
`,
      'server/routes/parent.ts': `import { Router } from 'express';
import childRouter from './child.js';
const router = Router();
router.use('/sub', childRouter);
export default router;
`,
      'server/routes/child.ts': `import { Router } from 'express';
const router = Router();
router.post('/x', (req, res) => res.sendStatus(200));
export default router;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/POST \/foo\/sub\/x/);
    expect(r.stderr).toMatch(/child\.ts/);
  });

  it('does not flag a nested sub-router composed under /api', () => {
    // Same composition shape as the test above, just rooted at /api/...
    // — should pass cleanly now that propagation is transitive.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import parentRouter from './routes/parent.js';
const app = express();
app.use('/api/parent', parentRouter);
`,
      'server/routes/parent.ts': `import { Router } from 'express';
import childRouter from './child.js';
const router = Router();
router.use('/sub', childRouter);
export default router;
`,
      'server/routes/child.ts': `import { Router } from 'express';
const router = Router();
router.post('/x', (req, res) => res.sendStatus(200));
export default router;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('flags a 3-level nested chain whose root mount is non-/api', () => {
    // grandparent at /foo, grandparent.use('/p', parent),
    // parent.use('/c', child), child.post('/x').
    // Effective path: /foo/p/c/x — must be flagged transitively.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import grandparentRouter from './routes/grandparent.js';
const app = express();
app.use('/foo', grandparentRouter);
app.use('/api', csrfProtection);
`,
      'server/routes/grandparent.ts': `import { Router } from 'express';
import parentRouter from './parent.js';
const router = Router();
router.use('/p', parentRouter);
export default router;
`,
      'server/routes/parent.ts': `import { Router } from 'express';
import childRouter from './child.js';
const router = Router();
router.use('/c', childRouter);
export default router;
`,
      'server/routes/child.ts': `import { Router } from 'express';
const router = Router();
router.post('/x', (req, res) => res.sendStatus(200));
export default router;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/POST \/foo\/p\/c\/x/);
  });

  it('flags the same child mounted in two parents when one parent is non-/api (fan-out)', () => {
    // The same child router is composed under two different parents.
    // One parent is mounted at /api (safe), the other at /pub (bad).
    // Propagation must produce BOTH effective prefixes for the child
    // and only flag the non-/api one.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import safeParent from './routes/safe-parent.js';
import sneakyParent from './routes/sneaky-parent.js';
const app = express();
app.use('/api/safe', safeParent);
app.use('/pub', sneakyParent);
app.use('/api', csrfProtection);
`,
      'server/routes/safe-parent.ts': `import { Router } from 'express';
import sharedChild from './shared-child.js';
const router = Router();
router.use('/c', sharedChild);
export default router;
`,
      'server/routes/sneaky-parent.ts': `import { Router } from 'express';
import sharedChild from './shared-child.js';
const router = Router();
router.use('/c', sharedChild);
export default router;
`,
      'server/routes/shared-child.ts': `import { Router } from 'express';
const router = Router();
router.post('/x', (req, res) => res.sendStatus(200));
export default router;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/POST \/pub\/c\/x/);
    // The /api/safe/c/x mount must NOT appear as a violation.
    expect(r.stderr).not.toMatch(/\/api\/safe\/c\/x/);
  });

  it('handles middlewares between the prefix and the child in nested router.use(...)', () => {
    // parent.use('/sub', mwA, mwB, childRouter). The child is the LAST
    // identifier in the rest-args, mirroring the heuristic for app.use.
    // The guard must still attribute /foo/sub/x to childRouter, not get
    // confused by the middleware idents.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import parentRouter from './routes/parent.js';
const app = express();
app.use('/foo', parentRouter);
app.use('/api', csrfProtection);
`,
      'server/routes/parent.ts': `import { Router } from 'express';
import childRouter from './child.js';
import requireAuth from '../middleware/auth.js';
import requireOrg from '../middleware/org.js';
const router = Router();
router.use('/sub', requireAuth, requireOrg, childRouter);
export default router;
`,
      'server/routes/child.ts': `import { Router } from 'express';
const router = Router();
router.post('/x', (req, res) => res.sendStatus(200));
export default router;
`,
      'server/middleware/auth.ts': `export default function requireAuth(req, res, next) { next(); }
`,
      'server/middleware/org.ts': `export default function requireOrg(req, res, next) { next(); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/POST \/foo\/sub\/x/);
  });

  it('does not blow up on same-file nested composition (parent and child Router vars in one file)', () => {
    // The "file-as-router" model used by this script can't accurately
    // distinguish parent-router routes from child-router routes when
    // both live in the same file, so same-file composition is
    // intentionally NOT propagated (see ROUTER_USE_RE handling in the
    // script). What matters here is that the script doesn't crash or
    // hang on the pattern: a parent and a child Router var co-located
    // in one file, mounted under /api so the file's own routes are
    // safe. The script should exit 0 cleanly.
    const dir = makeIndexFixture(
      `import express, { Router } from 'express';
const app = express();
const parentRouter = Router();
const childRouter = Router();
childRouter.post('/x', (req, res) => res.sendStatus(200));
parentRouter.use('/sub', childRouter);
app.use('/api/parent', parentRouter);
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('handles middlewares between the prefix and the router in app.use(...)', () => {
    // app.use('/foo', requireAuth, sneakyRouter) — the router is the
    // last identifier, not the first. The guard must still detect
    // the violation.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import sneakyRouter from './routes/sneaky.js';
import requireAuth from './middleware/auth.js';
const app = express();
app.use('/foo', requireAuth, sneakyRouter);
`,
      'server/routes/sneaky.ts': `import { Router } from 'express';
const router = Router();
router.post('/bar', (req, res) => res.sendStatus(200));
export default router;
`,
      'server/middleware/auth.ts': `export default function requireAuth(req, res, next) { next(); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/POST \/foo\/bar/);
  });

  it('does not flag a router file with no recorded mount (orphan/dead code)', () => {
    // No app.use(..., orphanRouter) anywhere — the guard skips it
    // because there's no live exposure to compute an effective path
    // for. (A separate dead-code check would be the right place to
    // catch this; it's out of scope for the CSRF guard.)
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
const app = express();
app.use('/api', csrfProtection);
`,
      'server/routes/orphan.ts': `import { Router } from 'express';
const router = Router();
router.post('/whatever', (req, res) => res.sendStatus(200));
export default router;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('skips files under __tests__ directories', () => {
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
const app = express();
app.use('/api', csrfProtection);
`,
      'server/__tests__/fixture.ts': `import express from 'express';
const app = express();
app.post('/test-only', (req, res) => res.sendStatus(200));
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('skips *.test.ts files', () => {
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
const app = express();
app.use('/api', csrfProtection);
`,
      'server/something.test.ts': `import express from 'express';
const app = express();
app.post('/in-a-test', (req, res) => res.sendStatus(200));
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });
});
