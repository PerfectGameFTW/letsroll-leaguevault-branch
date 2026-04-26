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

// Deny-list (#501): the inverse of the safe lists above. The script
// reads these constants out of this file via the AST. Mirrors the
// shape used in the real server/utils/api.ts so the fixture path
// and the production path exercise the same parser.
export const SENSITIVE_USER_FIELDS = ['password', 'secret'] as const;
export const SENSITIVE_ORG_FIELDS = ['integrations'] as const;

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

  it('flags a helper whose return type embeds a User in a property', () => {
    // The guard must descend into properties of named (non-anonymous)
    // object types so a future helper like `buildAccountResponse(user)`
    // returning `{ user: User; emailSent: boolean }` can't smuggle a
    // raw row past the wire-sanitization check just by hiding it
    // behind a wrapper at the call site.
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const user: User;
function buildAccountResponse(u: User) {
  return { user: u, emailSent: true };
}
export function bad() { sendSuccess(res, buildAccountResponse(user)); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- User/);
    expect(r.stderr).toMatch(/leak\.ts/);
  }, 30_000);

  it('flags a helper return type that embeds Organization[] in a property', () => {
    // Same shape, but for the array-of-Organization wrapper that a
    // listing helper might return.
    const dir = makeFixture({
      'server/leak.ts': `import type { Organization } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const orgs: Organization[];
function buildOrgList(list: Organization[]) {
  return { organizations: list, total: list.length };
}
export function bad() { sendSuccess(res, buildOrgList(orgs)); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- Organization/);
  }, 30_000);

  it('terminates on cyclic User <-> Organization schema references', () => {
    // Regression for the depth/visited bound: when User has
    // `organization: Organization` and Organization has
    // `users: User[]`, the property descent must not loop forever.
    // The guard should still flag the embedded User on the helper's
    // return type without hanging or stack-overflowing.
    const dir = makeFixture({
      'shared/schema/users.ts': `import type { Organization } from './organizations';
export type User = {
  id: number;
  email: string;
  password: string;
  name: string;
  secret: string;
  organization: Organization;
  createdAt: string;
};
`,
      'shared/schema/organizations.ts': `import type { User } from './users';
export type Organization = {
  id: number;
  name: string;
  slug: string;
  integrations: Record<string, unknown>;
  users: User[];
  createdAt: string;
};
`,
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const user: User;
function wrap(u: User) {
  return { user: u, ts: Date.now() };
}
export function bad() { sendSuccess(res, wrap(user)); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- User/);
  }, 30_000);

  // ---------------------------------------------------------------
  // Deny-list pass (task #501) — catches hand-rolled projections
  // that pick a SUBSET of a User/Organization row and include a
  // sensitive column. These shapes are NOT structurally assignable
  // to the full row (they're missing required columns), so they
  // pass the structural assignability pass above and have to be
  // caught by the name-based deny-list pass instead.
  // ---------------------------------------------------------------

  it('flags a manual { id, password: u.password } projection (initializer leak)', () => {
    // The canonical motivating case: a route that hand-builds an
    // object containing the user's id alongside their hashed
    // password. The shape is `{ id: number, password: string }` —
    // assignable to neither `User` (missing required columns) nor
    // `SanitizedUser` (extra `password` key would be a TS error in
    // strict mode, but most call sites are not annotated). The
    // deny-list scanner catches it via the property NAME `password`.
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const u: User;
export function bad() { sendSuccess(res, { id: u.id, password: u.password }); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- sensitive:password/);
    expect(r.stderr).toMatch(/leak\.ts/);
  }, 30_000);

  it('flags a manual { slug, integrations: org.integrations } projection on Organization', () => {
    // Same shape but on the Organization side — a route that ships
    // a bespoke org subset and includes the OAuth-tokens JSONB
    // column. Caught by name-match on `integrations`.
    const dir = makeFixture({
      'server/leak.ts': `import type { Organization } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const org: Organization;
export function bad() { sendSuccess(res, { slug: org.slug, integrations: org.integrations }); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- sensitive:integrations/);
  }, 30_000);

  it('flags a renamed-key initializer leak (e.g. { token: u.password })', () => {
    // The property NAME is innocuous, but the INITIALIZER reads the
    // sensitive column off another value. The deny-list scanner has
    // to walk the initializer expression to catch this.
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const u: User;
export function bad() { sendSuccess(res, { id: u.id, token: u.password }); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- sensitive:password/);
  }, 30_000);

  it('flags a shorthand { password } property even when source is unrelated', () => {
    // A shorthand whose name happens to be on the deny-list. The
    // value behind it doesn't have to be a User column for the
    // scanner to fire — shipping a property literally named
    // "password" to the wire is the leak we want to prevent.
    const dir = makeFixture({
      'server/leak.ts': `import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const password: string;
export function bad() { sendSuccess(res, { password }); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- sensitive:password/);
  }, 30_000);

  it('flags an element-access initializer leak (e.g. { x: u["password"] })', () => {
    // `u['password']` is the same read as `u.password`, just spelled
    // through index access — a trivial bypass of property-access
    // matching. The scanner unwraps element access with a string-
    // literal argument and treats it the same way.
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const u: User;
export function bad() { sendSuccess(res, { id: u.id, p: u['password'] }); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- sensitive:password/);
  }, 30_000);

  it('flags a sensitive property nested inside a wrapper literal', () => {
    // Recursion contract for the deny-list pass: nested object
    // literals inside the data argument are walked too, so the
    // wrapper key (`data`) doesn't smuggle the leak past the scan.
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const u: User;
export function bad() {
  sendSuccess(res, { data: { id: u.id, password: u.password } });
}
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- sensitive:password/);
  }, 30_000);

  it('flags a sensitive read past a value-preserving cast (e.g. (u.password as string))', () => {
    // The unwrap helper has to see through `as`, `!`, and `satisfies`
    // so an author can't defeat the deny-list with a noop cast. This
    // pins the unwrap contract.
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const u: User;
export function bad() { sendSuccess(res, { id: u.id, t: (u.password as string) }); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- sensitive:password/);
  }, 30_000);

  it('does NOT flag a manual projection of only safe fields', () => {
    // The negative half of the contract: a hand-rolled subset that
    // only picks columns on the safe list (id, email, name) is the
    // intended escape hatch and must stay green.
    const dir = makeFixture({
      'server/safe.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const u: User;
export function ok() {
  sendSuccess(res, { id: u.id, email: u.email, name: u.name });
}
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);

  it('does NOT flag the canonical sanitizeUser wrap', () => {
    // sanitizeUser returns a SanitizedUser — neither structurally
    // assignable to User (passes pass 1) nor exposes a sensitive
    // property name to the inline literal walker (passes pass 2).
    const dir = makeFixture({
      'server/safe.ts': `import type { User } from '@shared/schema';
import { sendSuccess, sanitizeUser, type Response } from './utils/api';
declare const res: Response;
declare const u: User;
export function ok() { sendSuccess(res, { user: sanitizeUser(u), emailSent: true }); }
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
