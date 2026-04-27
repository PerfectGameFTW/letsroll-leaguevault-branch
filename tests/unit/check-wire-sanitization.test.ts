/**
 * Tests the raw-row wire-sanitization CI guard introduced in task
 * #382, extended to Location/Bowler in task #505, and extended to
 * Payment in task #536.
 *
 * The guard (`scripts/check-wire-sanitization.ts`) loads the project's
 * TypeScript program and fails when `sendSuccess`,
 * `sendPaginatedSuccess`, or `res.json` / `res.status(...).json` is
 * called with a value structurally assignable to the canonical `User`,
 * `Organization`, `Location`, `Bowler`, or `Payment` row type —
 * bypassing `sanitizeUser` / `sanitizeOrg` / `sanitizeLocation` /
 * `sanitizeBowler` / `sanitizePayment` from `server/utils/api.ts`.
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
 * Organization / Location / Bowler) + sanitize helpers + the
 * user-supplied test files. Each call returns the fixture root so
 * the script can be run against it via `runIn(dir)`.
 *
 * Rationale: the script reads `process.cwd()/tsconfig.json` to
 * build a TypeScript program, so we have to give it a real (if
 * tiny) tsconfig that sees real (if tiny) declarations of every
 * canonical row type the guard knows about. The shapes here mirror
 * the production rows closely enough to exercise the full
 * assignability story (sensitive fields → can't be satisfied by a
 * Sanitized* projection).
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
    'shared/schema/locations.ts',
    `export type Location = {
  id: number;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  organizationId: number;
  paymentProvider: string;
  squareCredentials: Record<string, unknown>;
  cardpointeCredentials: Record<string, unknown>;
};
`,
  );

  writeFile(
    'shared/schema/bowlers.ts',
    `export type Bowler = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  organizationId: number;
  paymentCustomerId: string | null;
  cardpointeProfileId: string | null;
  paymentProviderLocationId: number | null;
  bnContactId: string | null;
};
`,
  );

  writeFile(
    'shared/schema/payments.ts',
    `export type Payment = {
  id: number;
  bowlerId: number;
  leagueId: number;
  amount: number;
  status: string;
  type: string;
  providerPaymentId: string | null;
  cardpointeAuthcode: string | null;
  // A future sensitive column the safe-list / sanitizer would have
  // to drop, mirroring the squareCredentials shape on Location: any
  // route returning a raw Payment would ship this verbatim, so the
  // structural lint must catch the leak here too.
  processorWebhookSecret: string | null;
  createdAt: string;
};
`,
  );

  writeFile(
    'shared/schema/index.ts',
    `export type { User } from './users';
export type { Organization } from './organizations';
export type { Location } from './locations';
export type { Bowler } from './bowlers';
export type { Payment } from './payments';
`,
  );

  writeFile(
    'server/utils/api.ts',
    `import type { User } from '../../shared/schema/users';
import type { Organization } from '../../shared/schema/organizations';
import type { Location } from '../../shared/schema/locations';
import type { Bowler } from '../../shared/schema/bowlers';
import type { Payment } from '../../shared/schema/payments';

export type SanitizedUser = Pick<User, 'id' | 'email' | 'name' | 'createdAt'>;
export type SanitizedOrganization = Pick<Organization, 'id' | 'name' | 'slug' | 'createdAt'>;
export type SanitizedLocation = Pick<Location, 'id' | 'name' | 'address' | 'city' | 'state' | 'zipCode' | 'organizationId' | 'paymentProvider'>;
export type SanitizedBowler = Pick<Bowler, 'id' | 'name' | 'email' | 'phone' | 'active' | 'organizationId' | 'paymentCustomerId' | 'bnContactId'>;
export type SanitizedPayment = Pick<Payment, 'id' | 'bowlerId' | 'leagueId' | 'amount' | 'status' | 'type' | 'providerPaymentId' | 'cardpointeAuthcode' | 'createdAt'>;

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
export function sanitizeLocation(l: Location): SanitizedLocation {
  return l as unknown as SanitizedLocation;
}
export function sanitizeLocations(ls: Location[]): SanitizedLocation[] {
  return ls.map(sanitizeLocation);
}
export function sanitizeBowler(b: Bowler): SanitizedBowler {
  return b as unknown as SanitizedBowler;
}
export function sanitizeBowlers(bs: Bowler[]): SanitizedBowler[] {
  return bs.map(sanitizeBowler);
}
export function sanitizePayment(p: Payment): SanitizedPayment {
  return p as unknown as SanitizedPayment;
}
export function sanitizePayments(ps: Payment[]): SanitizedPayment[] {
  return ps.map(sanitizePayment);
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
    expect(r.stdout).toMatch(/no raw User\/Organization\/Location\/Bowler\/Payment values/);
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

  // ---------------------------------------------------------------
  // Location / Bowler structural assignability (task #505) — same
  // pass-1 contract as User/Organization, just expanded to two more
  // canonical row types. The acceptance criterion is that adding
  // `sendSuccess(res, bowler)` or `res.json(location)` back to a
  // route fails the lint, and that the existing wraps in
  // `server/routes/{locations,bowlers,user-bowlers,teams}.ts`
  // (#381) stay green — the latter is covered by the
  // "runs against the real codebase" test above.
  // ---------------------------------------------------------------

  it('flags res.json(location) where location is Location', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { Location } from '@shared/schema';
import { type Response } from './utils/api';
declare const res: Response;
declare const location: Location;
export function bad() { res.json(location); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/res\.json\(\) <- Location/);
    expect(r.stderr).toMatch(/leak\.ts/);
  }, 30_000);

  it('flags sendSuccess(res, bowler) where bowler is Bowler', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { Bowler } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const bowler: Bowler;
export function bad() { sendSuccess(res, bowler); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/sendSuccess\(\) <- Bowler/);
    expect(r.stderr).toMatch(/leak\.ts/);
  }, 30_000);

  it('flags sendSuccess(res, locations) where locations is Location[]', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { Location } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const locations: Location[];
export function bad() { sendSuccess(res, locations); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- Location\[\]/);
  }, 30_000);

  it('flags sendSuccess(res, bowlers) where bowlers is Bowler[]', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { Bowler } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const bowlers: Bowler[];
export function bad() { sendSuccess(res, bowlers); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- Bowler\[\]/);
  }, 30_000);

  it('does NOT flag sanitizeLocation(location) / sanitizeLocations(list)', () => {
    const dir = makeFixture({
      'server/safe.ts': `import type { Location } from '@shared/schema';
import { sendSuccess, sanitizeLocation, sanitizeLocations, type Response } from './utils/api';
declare const res: Response;
declare const location: Location;
declare const locations: Location[];
export function ok1() { sendSuccess(res, sanitizeLocation(location)); }
export function ok2() { sendSuccess(res, sanitizeLocations(locations)); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);

  it('does NOT flag the { ...sanitizeBowler(b), hasAccount } spread used in bowlers/teams routes', () => {
    // The canonical bowler spread shape from
    // `server/routes/bowlers.ts` and `server/routes/teams.ts`
    // (task #381). `sanitizeBowler` returns a `SanitizedBowler`,
    // which is a `Pick<Bowler, …>` missing the unsafe columns —
    // so the spread+extra-key result is `SanitizedBowler & {
    // hasAccount: boolean }`, NOT structurally assignable to
    // `Bowler` (it's missing required columns like
    // `cardpointeProfileId`). The structural pass must stay
    // silent on this exact pattern.
    const dir = makeFixture({
      'server/safe.ts': `import type { Bowler } from '@shared/schema';
import { sendSuccess, sanitizeBowler, type Response } from './utils/api';
declare const res: Response;
declare const bowler: Bowler;
declare const hasAccount: boolean;
export function ok() {
  sendSuccess(res, { ...sanitizeBowler(bowler), hasAccount });
}
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);

  it('flags { ...bowler, extra } spread of a raw Bowler row', () => {
    // Negative counterpart to the wrap-then-spread test above —
    // spreading the RAW row (not the sanitized projection) is
    // exactly the leak shape the guard exists to catch.
    const dir = makeFixture({
      'server/leak.ts': `import type { Bowler } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const bowler: Bowler;
export function bad() { sendSuccess(res, { ...bowler, foo: 'bar' }); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- Bowler/);
  }, 30_000);

  // ---------------------------------------------------------------
  // Payment structural assignability (task #536) — same pass-1
  // contract as User/Organization/Location/Bowler, expanded to
  // cover the canonical Payment row type. Acceptance: a future
  // route that returns `storage.getPayment*` output through
  // `sendSuccess` / `res.json` / a paginated wrapper without
  // calling `sanitizePayment` / `sanitizePayments` fails the
  // lint, and the existing wraps in
  // `server/routes/payments/{payment-reports,payment-record,payment-refunds}.ts`
  // (#504) plus `server/routes/admin.ts` and
  // `server/routes/bowlers.ts` stay green — the latter is
  // covered by the "runs against the real codebase" test above.
  // ---------------------------------------------------------------

  it('flags sendSuccess(res, payment) where payment is Payment', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { Payment } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const payment: Payment;
export function bad() { sendSuccess(res, payment); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/sendSuccess\(\) <- Payment/);
    expect(r.stderr).toMatch(/leak\.ts/);
  }, 30_000);

  it('flags sendSuccess(res, payments) where payments is Payment[]', () => {
    // Array-of-row leak via the numeric-index descent — the
    // canonical list-endpoint shape (`getPaymentsByLeague`,
    // `getRecentPayments`, etc.) returns `Payment[]`.
    const dir = makeFixture({
      'server/leak.ts': `import type { Payment } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const payments: Payment[];
export function bad() { sendSuccess(res, payments); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- Payment\[\]/);
  }, 30_000);

  it('flags res.json(payment) where payment is Payment', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { Payment } from '@shared/schema';
import { type Response } from './utils/api';
declare const res: Response;
declare const payment: Payment;
export function bad() { res.json(payment); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/res\.json\(\) <- Payment/);
  }, 30_000);

  it('flags Payment | undefined (the typical storage.getPayment return)', () => {
    // `storage.getPayment(id)` returns `Payment | undefined` — the
    // union descent has to cover this so a route that forwards the
    // optional-row result straight through to `sendSuccess` is
    // caught the same way `User | undefined` is.
    const dir = makeFixture({
      'server/leak.ts': `import type { Payment } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const maybePayment: Payment | undefined;
export function bad() { sendSuccess(res, maybePayment); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- Payment/);
  }, 30_000);

  it('flags shorthand { payment } where payment is Payment', () => {
    // The destructured/shorthand-property leak shape — a route
    // that builds `sendSuccess(res, { payment })` with a raw row
    // is the canonical "embedded under a response key" form
    // called out in the task description.
    const dir = makeFixture({
      'server/leak.ts': `import type { Payment } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const payment: Payment;
export function bad() { sendSuccess(res, { payment }); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- Payment/);
  }, 30_000);

  it('flags an aliased { recentPayments: payments } embedding a raw Payment[]', () => {
    // The "embedded under a response key like `recentPayments` /
    // `payments`" pattern explicitly called out in the task. The
    // outer object is not assignable to `Payment` (or `Payment[]`),
    // but the property-walk descent has to flag the inner
    // `Payment[]` value through the wrapper key.
    const dir = makeFixture({
      'server/leak.ts': `import type { Payment } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const payments: Payment[];
export function bad() { sendSuccess(res, { recentPayments: payments }); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- Payment/);
  }, 30_000);

  it('flags { ...payment, extra } spread of a raw Payment row', () => {
    // Same spread-of-row shape that the User/Organization/Bowler
    // tests above pin — a route that augments a raw payment with a
    // computed field still ships every column on the row.
    const dir = makeFixture({
      'server/leak.ts': `import type { Payment } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const payment: Payment;
export function bad() { sendSuccess(res, { ...payment, displayLabel: 'x' }); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- Payment/);
  }, 30_000);

  it('flags sendPaginatedSuccess(res, payments, pagination) with raw Payment[]', () => {
    // Paginated-response shape — `sendPaginatedSuccess` is the
    // helper used by `payment-reports.ts` and several admin
    // listings. The data argument is the SAME structural slot as
    // for `sendSuccess`, so the existing detection must fire.
    const dir = makeFixture({
      'server/leak.ts': `import type { Payment } from '@shared/schema';
import { sendPaginatedSuccess, type Response } from './utils/api';
declare const res: Response;
declare const payments: Payment[];
export function bad() {
  sendPaginatedSuccess(res, payments, { page: 1, limit: 50 });
}
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/sendPaginatedSuccess\(\) <- Payment\[\]/);
  }, 30_000);

  it('does NOT flag sanitizePayment(payment) / sanitizePayments(list)', () => {
    // The canonical safe wraps. `SanitizedPayment` is a
    // `Pick<Payment, …>` missing `processorWebhookSecret`, so it
    // is NOT structurally assignable to `Payment` and the guard
    // stays silent.
    const dir = makeFixture({
      'server/safe.ts': `import type { Payment } from '@shared/schema';
import { sendSuccess, sendPaginatedSuccess, sanitizePayment, sanitizePayments, type Response } from './utils/api';
declare const res: Response;
declare const payment: Payment;
declare const payments: Payment[];
export function ok1() { sendSuccess(res, sanitizePayment(payment)); }
export function ok2() { sendSuccess(res, sanitizePayments(payments)); }
export function ok3() { sendSuccess(res, payments.map(sanitizePayment)); }
export function ok4() {
  sendPaginatedSuccess(res, sanitizePayments(payments), { page: 1, limit: 50 });
}
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);

  it('does NOT flag { recentPayments: sanitizePayments(list), total } (the safe embedded shape)', () => {
    // Negative half of the embedded-key shape: the inner value is
    // a `SanitizedPayment[]`, not a `Payment[]`, so the property
    // descent finds nothing to report.
    const dir = makeFixture({
      'server/safe.ts': `import type { Payment } from '@shared/schema';
import { sendSuccess, sanitizePayments, type Response } from './utils/api';
declare const res: Response;
declare const payments: Payment[];
export function ok() {
  sendSuccess(res, { recentPayments: sanitizePayments(payments), total: payments.length });
}
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);

  // ---------------------------------------------------------------
  // String-index / dictionary-shape descent (task #532). The earlier
  // structural pass walked union members, numeric-index types, and
  // named properties of object/intersection types — so a helper
  // returning `{ user: User }` was caught (task #500). It did NOT
  // walk string-index types, which meant `Record<string, User>` (or
  // any object whose only access path is a string index signature
  // like `{ [orgSlug: string]: Organization }`) sneaked past the
  // guard: the bare Record has no enumerable named properties to
  // descend into, and the structural assignability check at the top
  // of `findLeakInType` doesn't fire because Record-of-User is not
  // assignable to User itself. Same shape of risk as the numeric-
  // index case (`User[]` would have slipped past before the
  // numeric-index descent was added) — these tests pin the new
  // string-index descent so it can't be removed silently.
  // ---------------------------------------------------------------

  it('flags a helper returning Record<string, User> (the canonical Record leak)', () => {
    const dir = makeFixture({
      'server/leak.ts': `import type { User } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const users: User[];
function buildUserDirectory(list: User[]): Record<string, User> {
  const out: Record<string, User> = {};
  for (const u of list) out[u.email] = u;
  return out;
}
export function bad() { sendSuccess(res, buildUserDirectory(users)); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- User/);
    expect(r.stderr).toMatch(/leak\.ts/);
  }, 30_000);

  it('flags a Record<string, Organization> shape on the Organization side', () => {
    // Same gap, expressed via the explicit index-signature spelling
    // rather than the `Record<…>` alias — the descent has to be on
    // the string-index TYPE, not on the spelling, so both forms
    // need to fire.
    const dir = makeFixture({
      'server/leak.ts': `import type { Organization } from '@shared/schema';
import { sendSuccess, type Response } from './utils/api';
declare const res: Response;
declare const bySlug: { [orgSlug: string]: Organization };
export function bad() { sendSuccess(res, bySlug); }
`,
    });
    const r = runIn(dir);
    expect(r.status, r.stdout || r.stderr).toBe(1);
    expect(r.stderr).toMatch(/<- Organization/);
  }, 30_000);

  it('does NOT flag Record<string, SanitizedUser> (the safe projected dictionary)', () => {
    // The negative half of the contract. The whole point of the
    // descent is that it sees through the wrapper — but it must
    // still respect the structural assignability check on the
    // VALUE type. A `SanitizedUser` is a `Pick<User, …>` missing
    // the sensitive columns, so it is NOT assignable to `User`,
    // and a `Record<string, SanitizedUser>` is the intended safe
    // shape for a dictionary response. Must stay green.
    const dir = makeFixture({
      'server/safe.ts': `import type { User } from '@shared/schema';
import { sendSuccess, sanitizeUser, type Response, type SanitizedUser } from './utils/api';
declare const res: Response;
declare const users: User[];
function buildSafeDirectory(list: User[]): Record<string, SanitizedUser> {
  const out: Record<string, SanitizedUser> = {};
  for (const u of list) out[u.email] = sanitizeUser(u);
  return out;
}
export function ok() { sendSuccess(res, buildSafeDirectory(users)); }
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
