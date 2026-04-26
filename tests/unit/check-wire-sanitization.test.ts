/**
 * Tests the raw-User/Organization wire-sanitization CI guard
 * introduced in task #382.
 *
 * The guard (`scripts/check-wire-sanitization.ts`) loads the project's
 * TypeScript program and fails when `sendSuccess`,
 * `sendPaginatedSuccess`, or `res.json` / `res.status(...).json` is
 * called with a value structurally assignable to the canonical `User`
 * or `Organization` row type — bypassing `sanitizeUser` /
 * `sanitizeOrg` from `server/utils/api.ts`.
 *
 * These tests:
 *   1. Run the real script against the real codebase. This is the
 *      primary forcing function: a future PR that lands a route doing
 *      `sendSuccess(res, user)` instead of `sendSuccess(res,
 *      sanitizeUser(user))` will fail this test. Wired here (and not
 *      via an `npm run check:wire-sanitization` shortcut) because
 *      `package.json` is locked in this environment; CI also runs the
 *      script directly via `tsx scripts/check-wire-sanitization.ts`.
 *   2. Drive the script against synthetic TypeScript fixtures via
 *      spawnSync to pin down its detection logic for: raw-row leak,
 *      raw-array leak, spread-of-row leak, shorthand-property leak,
 *      `res.json` leak, `res.status(...).json` leak, and the
 *      canonical safe wraps (`sanitizeUser`, manual projection,
 *      message-only payload). Each fixture builds a self-contained
 *      mini-project (its own tsconfig, schema, sanitize helpers) so
 *      the test doesn't depend on the live codebase.
 */
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  mkdtempSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts/check-wire-sanitization.ts');

function runIn(
  cwd: string,
  args: string[] = [],
): { status: number; stdout: string; stderr: string } {
  // Resolve `tsx` against the real project's node_modules so the
  // synthetic fixtures (which have no node_modules of their own)
  // can still spawn the script.
  const tsxBin = join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const r = spawnSync(tsxBin, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Minimal mini-project: tsconfig + canonical schema (User /
 * Organization) + sanitize helpers + the user-supplied test files.
 * Each call returns the fixture root so the script can be run
 * against it via `runIn(dir)`.
 *
 * Rationale: the script reads `process.cwd()/tsconfig.json` to
 * build a TypeScript program, so we have to give it a real (if
 * tiny) tsconfig that sees a real (if tiny) `shared/schema/users.ts`
 * and `shared/schema/organizations.ts`. The User / Organization
 * shapes here mirror the production rows closely enough to exercise
 * the full assignability story (sensitive fields → can't be
 * satisfied by a SanitizedUser projection).
 */
function makeFixture(extraFiles: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'wire-sanitization-'));

  const writeFile = (rel: string, contents: string) => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  };

  writeFile(
    'tsconfig.json',
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
          baseUrl: '.',
          paths: { '@shared/*': ['./shared/*'] },
          types: [],
        },
        include: ['server/**/*', 'shared/**/*'],
      },
      null,
      2,
    ),
  );

  writeFile(
    'shared/schema/users.ts',
    `export type User = {
  id: number;
  email: string;
  password: string;
  name: string;
  secret: string;
  createdAt: string;
};
`,
  );

  writeFile(
    'shared/schema/organizations.ts',
    `export type Organization = {
  id: number;
  name: string;
  slug: string;
  integrations: Record<string, unknown>;
  createdAt: string;
};
`,
  );

  writeFile(
    'shared/schema/index.ts',
    `export type { User } from './users';
export type { Organization } from './organizations';
`,
  );

  writeFile(
    'server/utils/api.ts',
    `import type { User } from '../../shared/schema/users';
import type { Organization } from '../../shared/schema/organizations';

export type SanitizedUser = Pick<User, 'id' | 'email' | 'name' | 'createdAt'>;
export type SanitizedOrganization = Pick<Organization, 'id' | 'name' | 'slug' | 'createdAt'>;

// Stubbed bodies — the guard never executes, only type-checks.
export function sanitizeUser(u: User): SanitizedUser {
  return u as unknown as SanitizedUser;
}
export function sanitizeOrg(o: Organization): SanitizedOrganization {
  return o as unknown as SanitizedOrganization;
}

// Minimal Response stand-in so we don't need express in the fixture.
export interface Response {
  status(code: number): Response;
  json(data: unknown): void;
}

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}
export function sendPaginatedSuccess<T>(
  res: Response,
  data: T[],
  pagination: { page: number; limit: number },
): void {
  res.status(200).json({ success: true, data, pagination });
}
`,
  );

  for (const [rel, contents] of Object.entries(extraFiles)) {
    writeFile(rel, contents);
  }

  return dir;
}

describe('check-wire-sanitization CI guard', () => {
  /**
   * The actual CI forcing function. Running against the real
   * codebase MUST succeed — if a future PR adds a route that ships
   * a raw User/Organization to the wire, this test (and the CI
   * step that runs the script directly) will fail until the value
   * is wrapped in `sanitizeUser` / `sanitizeOrg`.
   *
   * The script is slow on the real codebase (~10–20s, since it
   * builds the full TS program) but that's the same cost as
   * `npm run check`. Vitest is configured with a generous test
   * timeout in `vitest.config.ts`.
   */
  it('runs against the real codebase and exits 0', () => {
    const r = runIn(process.cwd());
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/no raw User\/Organization values/);
  }, 60_000);

  it('flags sendSuccess(res, user) where user is User', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const user: User;
export function bad() { sendSuccess(res, user); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/sendSuccess\(\) <- User/);
    expect(r.stderr).toMatch(/leak\.ts/);
  }, 30_000);

  it('flags sendSuccess(res, users) where users is User[]', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const users: User[];
export function bad() { sendSuccess(res, users); }
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/sendSuccess\(\) <- User\[\]/);
  }, 30_000);

  it('flags { ...user, extra } spread of a User row', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const user: User;
export function bad() { sendSuccess(res, { ...user, foo: 'bar' }); }
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/<- User/);
  }, 30_000);

  it('flags shorthand { user } where user is User', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const user: User;
export function bad() { sendSuccess(res, { user }); }
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/<- User/);
  }, 30_000);

  it('flags res.json(org) where org is Organization', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { Organization } from '@shared/schema';
import { type Response } from './utils/api';
declare const res: Response;
declare const org: Organization;
export function bad() { res.json(org); }
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/res\.json\(\) <- Organization/);
  }, 30_000);

  it('flags res.status(200).json({ data: user }) chained call', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { type Response } from './utils/api';
declare const res: Response;
declare const user: User;
export function bad() { res.status(200).json({ data: user }); }
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/res\.json\(\) <- User/);
  }, 30_000);

  it('flags User | undefined (the typical storage.getUser return)', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const maybeUser: User | undefined;
export function bad() { sendSuccess(res, maybeUser); }
`,
    });
    const r = runIn(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/<- User/);
  }, 30_000);

  it('does NOT flag sanitizeUser(user)', () => {
    const dir = makeFixture({
      'server/safe.ts': `import type { User } from '@shared/schema';
import { sendSuccess, sanitizeUser, type Response } from './utils/api';
declare const res: Response;
declare const user: User;
export function ok() { sendSuccess(res, sanitizeUser(user)); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);

  it('does NOT flag users.map(sanitizeUser)', () => {
    const dir = makeFixture({
      'server/safe.ts': `import type { User } from '@shared/schema';
import { sendSuccess, sanitizeUser, type Response } from './utils/api';
declare const res: Response;
declare const users: User[];
export function ok() { sendSuccess(res, users.map(sanitizeUser)); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);

  it('does NOT flag a manual id+email projection', () => {
    const dir = makeFixture({
      'server/safe.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const user: User;
export function ok() {
  sendSuccess(res, { id: user.id, email: user.email, name: user.name });
}
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);

  it('does NOT flag a message-only payload', () => {
    const dir = makeFixture({
      'server/safe.ts': `import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
export function ok() { sendSuccess(res, { message: 'done' }); }
export function ok2() { sendSuccess(res, null); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);

  it('does NOT flag { user: sanitizeUser(u), extra }', () => {
    const dir = makeFixture({
      'server/safe.ts': `import type { User } from '@shared/schema';
import { sendSuccess, sanitizeUser, type Response } from './utils/api';
declare const res: Response;
declare const user: User;
export function ok() {
  sendSuccess(res, { user: sanitizeUser(user), emailSent: true });
}
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);

  it('does NOT flag .test.ts files (test fixtures often build raw rows)', () => {
    const dir = makeFixture({
      'server/leak.test.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const user: User;
export function bad() { sendSuccess(res, user); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);

  it('--report mode prints the violation table without exiting non-zero', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const user: User;
export function bad() { sendSuccess(res, user); }
`,
    });
    const r = runIn(dir, ['--report']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/REPORT/);
    expect(r.stderr).toMatch(/<- User/);
  }, 30_000);
});
