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

  it('flags app.all on a non-/api path (matches every HTTP method, including state-changing ones)', () => {
    // Express's `.all()` registers a single handler for EVERY HTTP
    // method — POST/PUT/PATCH/DELETE included — so a mount outside
    // /api would silently bypass CSRF the same way an explicit verb
    // would. The guard must flag it.
    const dir = makeIndexFixture(
      `import express from 'express';
const app = express();
app.all('/sneaky', (req, res) => res.sendStatus(200));
app.use('/api', csrfProtection);
`,
    );
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ALL \/sneaky/);
  });

  it('flags router.all on a sub-router mounted outside /api', () => {
    // Same coverage hole as app.all — but via a sub-router. The
    // effective path is /foo/bar, registered for every HTTP method,
    // so it must be flagged just like router.post('/bar') would be.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import sneakyRouter from './routes/sneaky.js';
const app = express();
app.use('/foo', sneakyRouter);
app.use('/api', csrfProtection);
`,
      'server/routes/sneaky.ts': `import { Router } from 'express';
const router = Router();
router.all('/bar', (req, res) => res.sendStatus(200));
export default router;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/ALL \/foo\/bar/);
    expect(r.stderr).toMatch(/sneaky\.ts/);
  });

  it('does not flag app.all mounted under /api', () => {
    // Negative twin of the app.all violation test — `.all()` under
    // /api is fine because the global /api CSRF mount applies.
    const dir = makeIndexFixture(
      `import express from 'express';
const app = express();
app.all('/api/catchall', (req, res) => res.sendStatus(200));
app.use('/api', csrfProtection);
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('does not flag router.all mounted under /api', () => {
    // Negative twin of the router.all violation test — same shape,
    // just rooted under /api so it's covered by the global mount.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import goodRouter from './routes/good.js';
const app = express();
app.use('/api/good', goodRouter);
`,
      'server/routes/good.ts': `import { Router } from 'express';
const router = Router();
router.all('/things', (req, res) => res.sendStatus(200));
export default router;
`,
    });
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

  it('flags only the child effective path on same-file nested composition at a non-/api root (task #446)', () => {
    // Parent and child Router vars in the SAME file. Parent has no
    // direct routes of its own — its only role is to compose the
    // child via `parent.use('/sub', child)`. Root mount is /foo
    // (non-/api). The per-(file, var) tracking in #446 lets the
    // guard model this precisely: prefixes on the parent var
    // propagate to the child var via the composition edge, the
    // child's POST /x lands at /foo/sub/x, and the parent var has no
    // routes of its own to spuriously flag at /foo/x.
    const dir = makeIndexFixture(
      `import express, { Router } from 'express';
const app = express();
const parentRouter = Router();
const childRouter = Router();
childRouter.post('/x', (req, res) => res.sendStatus(200));
parentRouter.use('/sub', childRouter);
app.use('/foo', parentRouter);
app.use('/api', csrfProtection);
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    // The child's effective path must be flagged.
    expect(r.stderr).toMatch(/POST \/foo\/sub\/x/);
    // And the file-as-router conflation that the prior model would
    // have produced (attributing the child's `POST /x` to the
    // parent's mount as well) must NOT appear. Asserting on the
    // literal output line ensures we catch a regression that
    // re-introduces the false-positive even if the legitimate
    // flag still fires.
    expect(r.stderr).not.toMatch(/POST \/foo\/x {2}/);
  });

  it("flags a default-exported factory router (e.g. `const r = createRouter()`) mounted at non-/api", () => {
    // The per-(file, var) refactor (#446) tracks routes only on
    // identifiers it recognises as Router vars. The recognition
    // primarily comes from `LOCAL_ROUTER_RE` (literal `Router()`/
    // `express.Router()` calls), but a contributor could create a
    // router via a factory wrapper (`createRouter()`) and just
    // export it as default. The guard must still treat the default-
    // exported identifier as the file's effective Router so that
    // routes registered on it are attributed and a non-/api mount
    // gets flagged. Without this admit-rule, the prior file-as-
    // router model would catch it but the per-var model wouldn't —
    // a strict regression of guard coverage.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import factoryRouter from './routes/factory.js';
const app = express();
app.use('/foo', factoryRouter);
app.use('/api', csrfProtection);
`,
      'server/routes/factory.ts': `import { Router } from 'express';
function createRouter() { return Router(); }
const r = createRouter();
r.post('/x', (req, res) => res.sendStatus(200));
export default r;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/POST \/foo\/x/);
    expect(r.stderr).toMatch(/factory\.ts/);
  });

  it('does not flag same-file nested composition rooted at /api (negative twin)', () => {
    // Same shape as the test above, just with the root mount under
    // /api. Effective path is /api/parent/sub/x — covered by the
    // global mount, no flags expected. Pins the negative direction
    // so a future tightening of the guard can't silently start
    // false-positiving on this real codebase pattern.
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

  // ----------------------------------------------------------------
  // `app.use('<path>', <inlineHandler>)` and
  // `router.use('<path>', <inlineHandler>)` coverage (task #471).
  //
  // Express's `.use(string, handler)` form installs the handler for
  // EVERY HTTP method on the path prefix — structurally identical to
  // `.all()` — so an inline arrow/function literal or an identifier
  // that doesn't resolve to a Router (i.e. a handler/middleware
  // import rather than a sub-router) outside `/api/` silently
  // bypasses the global CSRF mount. The earlier guard only
  // recognised `.use(...)` as a router mount and dropped the call
  // when the rest-args didn't resolve to one, leaving this hole
  // open. These tests pin down the new branch.
  // ----------------------------------------------------------------

  it('flags app.use with an inline arrow handler at a non-/api path (#471)', () => {
    const dir = makeIndexFixture(
      `import express from 'express';
const app = express();
app.use('/foo', (req, res) => res.sendStatus(200));
app.use('/api', csrfProtection);
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/USE \/foo/);
  });

  it('flags app.use with an inline `function` literal at a non-/api path (#471)', () => {
    // Same hole, just a `function` expression instead of an arrow.
    // The inline-handler detection has to recognise both forms.
    const dir = makeIndexFixture(
      `import express from 'express';
const app = express();
app.use('/foo', function (req, res) { return res.sendStatus(200); });
app.use('/api', csrfProtection);
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/USE \/foo/);
  });

  it('flags router.use(<handlerImport>) mounted at a non-/api prefix (#471)', () => {
    // Sub-router shape: parent router declares `router.use('/bar',
    // someHandlerImport)` where `someHandlerImport` is a default-
    // imported handler function (not a sub-router). Parent router is
    // mounted at /pub, so the effective path /pub/bar is a
    // state-changing handler outside /api and must be flagged.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import sneakyRouter from './routes/sneaky.js';
const app = express();
app.use('/pub', sneakyRouter);
app.use('/api', csrfProtection);
`,
      'server/routes/sneaky.ts': `import { Router } from 'express';
import someHandlerImport from './handler.js';
const router = Router();
router.use('/bar', someHandlerImport);
export default router;
`,
      'server/routes/handler.ts': `function handler(req, res, next) { return res.sendStatus(200); }
export default handler;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/USE \/pub\/bar/);
    expect(r.stderr).toMatch(/sneaky\.ts/);
  });

  it('flags app.use(<handlerImport>) at a non-/api prefix (#471)', () => {
    // Direct shape on `app`: `app.use('/foo', someHandlerImport)`
    // where the import is a plain handler, not a Router. The handler
    // is registered for EVERY HTTP method so the bypass is real.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import someHandlerImport from './handler.js';
const app = express();
app.use('/foo', someHandlerImport);
app.use('/api', csrfProtection);
`,
      'server/handler.ts': `function handler(req, res, next) { return res.sendStatus(200); }
export default handler;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/USE \/foo/);
  });

  it('does not flag app.use(<router>) at a non-/api prefix when the router has no state-changing routes (#471 negative twin)', () => {
    // The new handler-mount branch must NOT fire when the imported
    // identifier IS a recognised Router. The router is a real Router
    // file (literal `Router()` declaration); since it has no
    // state-changing routes, the existing router-mount handling
    // produces no violations and the call passes.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import someRouter from './routes/some.js';
const app = express();
app.use('/foo', someRouter);
app.use('/api', csrfProtection);
`,
      'server/routes/some.ts': `import { Router } from 'express';
const router = Router();
router.get('/bar', (req, res) => res.sendStatus(200));
export default router;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('does not flag app.use(<middleware>) when mounted under /api (#471 negative twin)', () => {
    // `app.use('/api', csrfProtection)` is the global CSRF mount
    // itself — `csrfProtection` is a named-imported middleware, not
    // a Router. The new handler-mount branch would classify this
    // call as a handler mount, but the prefix is /api so the
    // violation check skips it (existing behaviour preserved).
    const dir = makeIndexFixture(
      `import express from 'express';
const app = express();
app.use('/api', csrfProtection);
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('does not flag app.use with an inline arrow handler under /api (#471 negative twin)', () => {
    // `.use(string, inline-arrow)` mounted at /api is fine because
    // the global CSRF mount applies. Pins the negative direction so
    // a future tightening of the inline-handler detection doesn't
    // start false-positiving on /api mounts.
    const dir = makeIndexFixture(
      `import express from 'express';
const app = express();
app.use('/api/inline', (req, res) => res.sendStatus(200));
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('flags inline arrow handler when middlewares are listed before it (#471)', () => {
    // `app.use('/foo', requireAuth, (req, res) => ...)` — the inline
    // arrow is the LAST argument, not the first. Detection has to be
    // "anywhere in rest-args" rather than "as the first arg" so this
    // shape doesn't slip through.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import requireAuth from './middleware/auth.js';
const app = express();
app.use('/foo', requireAuth, (req, res) => res.sendStatus(200));
app.use('/api', csrfProtection);
`,
      'server/middleware/auth.ts': `export default function requireAuth(req, res, next) { next(); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/USE \/foo/);
  });

  it('does not classify a default-exported handler file as a Router (#471)', () => {
    // Pins the Pass-1 evidence guard: a file that default-exports a
    // plain function (no `Router()` declaration AND no
    // `<name>.<routerMethod>(...)` calls) must NOT be admitted as a
    // Router var. If it were, the resolver would silently treat
    // `app.use('/foo', importedHandler)` as a router mount with no
    // routes (no flags fire). With the guard, the call falls into
    // the new handler-mount branch instead and gets flagged.
    const dir = makeFixture({
      'server/index.ts': `import express from 'express';
import handler from './handler.js';
const app = express();
app.use('/foo', handler);
app.use('/api', csrfProtection);
`,
      'server/handler.ts': `function handler(req, res, next) { return res.sendStatus(200); }
export default handler;
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/USE \/foo/);
  });

  it('handles `app.use(express.static(...))`-style nested-paren rest-args without truncating mid-arg (#471)', () => {
    // Real codebase pattern: `app.use('/uploads/avatars',
    // express.static(path.join(...), { ... }))`. The earlier
    // `[^)]+` regex would have truncated the rest-args at the first
    // inner `)`, dropping the call entirely. The balanced-paren
    // walker has to span the whole call so the handler-mount branch
    // can correctly classify it. The synthetic fixture lives at
    // /pub-static (non-/api) to assert the call is flagged; in the
    // real `server/index.ts` the same shape lives at /uploads/
    // avatars, which is allowlisted with an inline justification.
    const dir = makeIndexFixture(
      `import express from 'express';
import path from 'path';
const app = express();
app.use('/pub-static', express.static(path.join(process.cwd(), 'pub'), {
  maxAge: '1h',
  fallthrough: true,
}));
app.use('/api', csrfProtection);
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/USE \/pub-static/);
  });
});
