/**
 * Regression test for Task #727: ensure worker-branch URLs are
 * composed using the password returned by the Neon control-plane
 * `reveal_password` endpoint, NOT the password baked into the
 * calling process's `DATABASE_URL`. See `tests/setup/neon-branches.ts`
 * for the full background.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRevealPasswordCacheForTests,
  buildBranchUrl,
  createBranchWithEndpoint,
  resolveBranchUrl,
  revealBranchRolePassword,
  type NeonConfig,
} from '../setup/neon-branches';

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
