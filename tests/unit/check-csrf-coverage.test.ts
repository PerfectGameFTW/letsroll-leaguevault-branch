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
