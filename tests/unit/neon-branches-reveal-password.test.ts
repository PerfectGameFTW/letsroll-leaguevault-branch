/**
 * Regression test for Task #727: ensure worker-branch URLs are
 * composed using the password returned by the Neon control-plane
 * `reveal_password` endpoint, NOT the password baked into the
 * calling process's `DATABASE_URL`. See `tests/setup/neon-branches.ts`
 * for the full background.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable `pg` stub: the cold-branch connectivity probe (Task #752)
// opens a short-lived `pg.Client` and runs `SELECT 1`. Tests drive its
// behaviour by swapping `pgState.connect` — the default is a clean
// success so the Task #727 reveal tests pass through the probe unchanged.
const { pgState } = vi.hoisted(() => ({
  pgState: {
    connect: null as null | ((connectionString: string) => Promise<void>),
    connectCalls: [] as string[],
  },
}));

vi.mock('pg', () => ({
  default: {
    Client: class {
      private readonly connectionString: string;
      constructor(opts: { connectionString: string }) {
        this.connectionString = opts.connectionString;
      }
      async connect(): Promise<void> {
        pgState.connectCalls.push(this.connectionString);
        if (pgState.connect) await pgState.connect(this.connectionString);
      }
      async query(): Promise<{ rows: unknown[] }> {
        return { rows: [{ ok: 1 }] };
      }
      async end(): Promise<void> {
        /* noop */
      }
    },
  },
}));

import {
  __resetRevealPasswordCacheForTests,
  buildBranchUrl,
  createBranchWithEndpoint,
  resolveBranchUrl,
  revealBranchRolePassword,
  verifyBranchUrl,
  type NeonConfig,
} from '../setup/neon-branches';

/** Build a `pg`-style error carrying the 28P01 SQLSTATE code. */
function invalidPasswordError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: '28P01' });
}

const cfg: NeonConfig = { apiKey: 'k', projectId: 'p1' };
const ENDPOINT_HOST = 'ep-fake-host-123.us-east-2.aws.neon.tech';
const REVEALED = 'revealed-secret-from-neon';
const STALE = 'stale-password-in-database-url';
const ORIG_DB_URL = process.env.DATABASE_URL;

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  // The Neon API wrapper only ever calls `fetch(string, init)`, so a
  // narrow shim matching that subset is sufficient — we don't need to
  // reproduce the full DOM `fetch` overload set here.
  return vi.fn((url: string, init?: RequestInit) => handler(url, init ?? {}));
}

describe('neon-branches reveal_password integration (Task #727)', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = `postgres://neondb_owner:${STALE}@orig-host.neon.tech/neondb?sslmode=require`;
    __resetRevealPasswordCacheForTests();
    // Default: the connectivity probe succeeds immediately so the
    // Task #727 reveal-path tests are unaffected.
    pgState.connect = null;
    pgState.connectCalls = [];
  });
  afterEach(() => {
    if (ORIG_DB_URL) process.env.DATABASE_URL = ORIG_DB_URL;
    else delete process.env.DATABASE_URL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('buildBranchUrl substitutes the explicit password (not DATABASE_URL\'s)', () => {
    const url = buildBranchUrl(ENDPOINT_HOST, REVEALED);
    const u = new URL(url);
    expect(u.password).toBe(REVEALED);
    expect(u.password).not.toBe(STALE);
    expect(u.hostname).toBe(ENDPOINT_HOST);
    expect(u.username).toBe('neondb_owner');
  });

  it('createBranchWithEndpoint composes URL with revealed password', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      fakeFetch((url) => {
        calls.push(url);
        if (url.endsWith('/reveal_password')) {
          return new Response(JSON.stringify({ password: REVEALED }), { status: 200 });
        }
        // POST /branches
        return new Response(
          JSON.stringify({
            branch: { id: 'br_new', name: 'test_worker_x', current_state: 'ready' },
            endpoints: [{ id: 'ep_new', host: ENDPOINT_HOST, type: 'read_write' }],
          }),
          { status: 200 },
        );
      }),
    );

    const created = await createBranchWithEndpoint(cfg, 'br_parent', 'test_worker_x');
    const u = new URL(created.url);
    expect(u.password).toBe(REVEALED);
    expect(u.password).not.toBe(STALE);
    expect(
      calls.some((u) => u.endsWith('/branches/br_new/roles/neondb_owner/reveal_password')),
    ).toBe(true);
  });

  it('resolveBranchUrl composes URL with revealed password', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch((url) => {
        if (url.endsWith('/reveal_password')) {
          return new Response(JSON.stringify({ password: REVEALED }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            endpoints: [{ id: 'ep_existing', host: ENDPOINT_HOST, type: 'read_write' }],
          }),
          { status: 200 },
        );
      }),
    );

    const url = await resolveBranchUrl(cfg, 'br_existing');
    const u = new URL(url);
    expect(u.password).toBe(REVEALED);
    expect(u.password).not.toBe(STALE);
  });

  it('revealBranchRolePassword memoises per (branchId, roleName)', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      fakeFetch(() => {
        calls++;
        return new Response(JSON.stringify({ password: REVEALED }), { status: 200 });
      }),
    );

    const a = await revealBranchRolePassword(cfg, 'br_x', 'neondb_owner');
    const b = await revealBranchRolePassword(cfg, 'br_x', 'neondb_owner');
    const c = await revealBranchRolePassword(cfg, 'br_x', 'other_role');
    expect(a).toBe(REVEALED);
    expect(b).toBe(REVEALED);
    expect(c).toBe(REVEALED);
    // Two distinct (branchId, roleName) keys → two API calls; the
    // duplicate (br_x, neondb_owner) is served from cache.
    expect(calls).toBe(2);
  });

  it('reveal failure surfaces a generic error (no payload echoed)', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch(
        () =>
          new Response(
            JSON.stringify({ password: 'super-secret-leak-me', extra: 'sensitive' }),
            { status: 403, statusText: 'Forbidden' },
          ),
      ),
    );

    let caught: unknown;
    try {
      await revealBranchRolePassword(cfg, 'br_z', 'neondb_owner');
    } catch (err) {
      caught = err;
    }
    const msg = caught instanceof Error ? caught.message : String(caught);
    expect(msg).toMatch(/could not reveal password for branch br_z role neondb_owner/);
    expect(msg).not.toContain('super-secret-leak-me');
    expect(msg).not.toContain('sensitive');
  });
});

describe('neon-branches cold-branch connectivity probe (Task #752)', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = `postgres://neondb_owner:${STALE}@orig-host.neon.tech/neondb?sslmode=require`;
    __resetRevealPasswordCacheForTests();
    pgState.connect = null;
    pgState.connectCalls = [];
  });
  afterEach(() => {
    if (ORIG_DB_URL) process.env.DATABASE_URL = ORIG_DB_URL;
    else delete process.env.DATABASE_URL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rides out a 28P01 warm-up window and re-reveals the password each retry', async () => {
    let revealCalls = 0;
    vi.stubGlobal(
      'fetch',
      fakeFetch((url) => {
        if (url.endsWith('/reveal_password')) {
          revealCalls++;
          // Each reveal returns a distinct password so we can prove the
          // probe recomposed the URL with the freshly-revealed value.
          return new Response(JSON.stringify({ password: `pw-${revealCalls}` }), {
            status: 200,
          });
        }
        return new Response('{}', { status: 200 });
      }),
    );

    let attempts = 0;
    pgState.connect = async () => {
      attempts++;
      // Fail the first two attempts with 28P01, succeed on the third.
      if (attempts < 3) {
        throw invalidPasswordError('password authentication failed for user "neondb_owner"');
      }
    };

    const initial = buildBranchUrl(ENDPOINT_HOST, 'pw-initial');
    const url = await verifyBranchUrl(cfg, 'br_cold', 'neondb_owner', ENDPOINT_HOST, initial, {
      baseDelayMs: 1,
    });

    expect(attempts).toBe(3);
    // Two retries → two force-refresh reveals (the cache is bypassed
    // each retry, otherwise revealCalls would stay at 1).
    expect(revealCalls).toBe(2);
    const u = new URL(url);
    expect(u.password).toBe('pw-2');
    expect(u.hostname).toBe(ENDPOINT_HOST);
  });

  it('re-reveals through a refreshed cache (does not serve a stale cached password)', async () => {
    // Seed the reveal cache with the "stale verifier" password.
    let revealCalls = 0;
    vi.stubGlobal(
      'fetch',
      fakeFetch((url) => {
        if (url.endsWith('/reveal_password')) {
          revealCalls++;
          return new Response(
            JSON.stringify({ password: revealCalls === 1 ? 'stale' : 'fresh' }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 200 });
      }),
    );

    const seeded = await revealBranchRolePassword(cfg, 'br_refresh', 'neondb_owner');
    expect(seeded).toBe('stale');

    let attempts = 0;
    pgState.connect = async (connectionString: string) => {
      attempts++;
      // The first probe (built with the seeded 'stale' password) fails;
      // the retry must use a re-revealed 'fresh' password.
      if (new URL(connectionString).password === 'stale') {
        throw invalidPasswordError('password authentication failed');
      }
    };

    const initial = buildBranchUrl(ENDPOINT_HOST, seeded);
    const url = await verifyBranchUrl(cfg, 'br_refresh', 'neondb_owner', ENDPOINT_HOST, initial, {
      baseDelayMs: 1,
    });

    expect(attempts).toBe(2);
    // Second reveal call proves the cache was force-refreshed.
    expect(revealCalls).toBe(2);
    expect(new URL(url).password).toBe('fresh');
  });

  it('surfaces a generic, secret-free error when the retry budget is exhausted', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch((url) => {
        if (url.endsWith('/reveal_password')) {
          return new Response(JSON.stringify({ password: 'super-secret-pw' }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }),
    );

    // Always fail with 28P01 — the warm-up window never closes.
    pgState.connect = async () => {
      throw invalidPasswordError('password authentication failed: super-secret-pw');
    };

    const initial = buildBranchUrl(ENDPOINT_HOST, 'super-secret-pw');
    let caught: unknown;
    try {
      await verifyBranchUrl(cfg, 'br_dead', 'neondb_owner', ENDPOINT_HOST, initial, {
        maxAttempts: 3,
        baseDelayMs: 1,
      });
    } catch (err) {
      caught = err;
    }
    const msg = caught instanceof Error ? caught.message : String(caught);
    expect(msg).toMatch(/branch br_dead connectivity probe failed after 3 attempt\(s\)/);
    expect(msg).toContain('28P01-warmup-timeout');
    expect(msg).not.toContain('super-secret-pw');
  });

  it('does not retry a non-28P01 connect error (fails fast, secret-free)', async () => {
    let revealCalls = 0;
    vi.stubGlobal(
      'fetch',
      fakeFetch((url) => {
        if (url.endsWith('/reveal_password')) {
          revealCalls++;
          return new Response(JSON.stringify({ password: 'pw' }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }),
    );

    let attempts = 0;
    pgState.connect = async () => {
      attempts++;
      throw Object.assign(new Error('getaddrinfo ENOTFOUND nope'), { code: 'ENOTFOUND' });
    };

    const initial = buildBranchUrl(ENDPOINT_HOST, 'pw');
    let caught: unknown;
    try {
      await verifyBranchUrl(cfg, 'br_net', 'neondb_owner', ENDPOINT_HOST, initial, {
        baseDelayMs: 1,
      });
    } catch (err) {
      caught = err;
    }
    // One attempt, no retry, no extra reveal.
    expect(attempts).toBe(1);
    expect(revealCalls).toBe(0);
    const msg = caught instanceof Error ? caught.message : String(caught);
    expect(msg).toMatch(/branch br_net connectivity probe failed after 1 attempt\(s\) \(connect-error\)/);
    expect(msg).not.toContain('ENOTFOUND');
  });

  it('createBranchWithEndpoint returns a verifier-confirmed URL', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch((url) => {
        if (url.endsWith('/reveal_password')) {
          return new Response(JSON.stringify({ password: REVEALED }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            branch: { id: 'br_new', name: 'test_worker_x', current_state: 'ready' },
            endpoints: [{ id: 'ep_new', host: ENDPOINT_HOST, type: 'read_write' }],
          }),
          { status: 200 },
        );
      }),
    );

    let attempts = 0;
    pgState.connect = async () => {
      attempts++;
      if (attempts < 2) {
        throw invalidPasswordError('password authentication failed');
      }
    };

    const created = await createBranchWithEndpoint(cfg, 'br_parent', 'test_worker_x');
    // The probe ran (and rode out one 28P01) before the URL was handed out.
    expect(attempts).toBe(2);
    expect(new URL(created.url).password).toBe(REVEALED);
  });
});
