/**
 * Tests the CSRF coverage CI guard introduced in task #308.
 *
 * The guard (`scripts/check-csrf-coverage.ts`) reads `server/index.ts`
 * and fails if any `app.post|put|patch|delete(...)` call targets a
 * path outside `/api/` without an explicit allowlist entry.
 *
 * These tests:
 *   1. Run the real script against a synthetic violating fixture and
 *      assert it exits non-zero with a useful message.
 *   2. Run the real script against the real `server/index.ts` (via
 *      a clean spawn) and assert it currently exits 0.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
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

function makeFixture(indexContents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'csrf-check-'));
  mkdirSync(join(dir, 'server'));
  writeFileSync(join(dir, 'server/index.ts'), indexContents);
  return dir;
}

describe('check-csrf-coverage CI guard', () => {
  it('passes against the real server/index.ts (sanity)', () => {
    const r = runIn(process.cwd());
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/OK/);
  });

  it('fails when a state-changing route is mounted directly on app outside /api', () => {
    const dir = makeFixture(
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
      const dir = makeFixture(
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
    const dir = makeFixture(
      `import express from 'express';
const app = express();
app.post('/api/teams', (req, res) => res.sendStatus(200));
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });

  it('does not flag app.get on non-/api paths (GET is not state-changing)', () => {
    const dir = makeFixture(
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
    const dir = makeFixture(
      `import express from 'express';
const app = express();
// app.post('/foo', handler);  // commented out
/* app.post('/bar', handler); */
`,
    );
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  });
});
