/**
 * Task #742: the cross-run startup sweep (`cleanupTestDbs({ connectionAware:
 * true })`) must reap crashed-run orphan branches while NEVER deleting a
 * concurrently-running sibling vitest process's live branch.
 *
 * Decision contract per `test_worker_*` branch:
 *   - no active compute (idle / no endpoint)           → DELETE (regardless of age)
 *   - live compute, zero connections across 2 probes   → DELETE (regardless of age)
 *   - live compute, >0 client connections (live run)   → KEEP
 *   - live compute, 0 then >0 (sibling transient gap)  → KEEP  (double-probe)
 *   - compute probe throws + branch older than minAgeMs → DELETE (fallback)
 *   - compute probe throws + branch younger than minAge → KEEP  (fallback)
 *
 * fetch (Neon control-plane) and pg.Client (the connection probe) are both
 * stubbed so this runs as a pure unit test with no network/DB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  /**
   * hostname → live client-connection count returned by the probe. A number
   * is returned for every probe; an array is consumed one element per probe
   * call (to model the double-probe), with the last element repeating.
   */
  connByHost: new Map<string, number | number[]>(),
  /** hostname → how many times the probe has queried it (for sequences). */
  probeCalls: new Map<string, number>(),
  /** hostnames whose `connect()` should reject (probe failure). */
  failConnectHosts: new Set<string>(),
  /** hostnames that actually had a probe connection opened. */
  connectedHosts: [] as string[],
}));

vi.mock('pg', () => {
  class FakeClient {
    private host: string;
    constructor(cfg: { connectionString: string }) {
      this.host = new URL(cfg.connectionString).hostname;
    }
    async connect(): Promise<void> {
      if (state.failConnectHosts.has(this.host)) {
        throw new Error('ECONNREFUSED: probe failed');
      }
      state.connectedHosts.push(this.host);
    }
    async query(sql: string): Promise<{ rows: Array<{ c: number }> }> {
      // `resolveBranchUrl` runs a `SELECT 1` connectivity *verifier*
      // (Task #752) before handing out the URL, on the same client this
      // probe later uses to COUNT connections. That verifier ping is not
      // a connection-count probe, so it must NOT advance the per-host
      // `connByHost` sequence or inflate `probeCalls` — only the
      // `pg_stat_activity` count query does. Distinguish them by SQL.
      if (!/pg_stat_activity/i.test(sql)) {
        return { rows: [{ c: 0 }] };
      }
      const n = state.probeCalls.get(this.host) ?? 0;
      state.probeCalls.set(this.host, n + 1);
      const v = state.connByHost.get(this.host) ?? 0;
      const c = Array.isArray(v) ? (v[Math.min(n, v.length - 1)] ?? 0) : v;
      return { rows: [{ c }] };
    }
    async end(): Promise<void> {}
  }
  return { default: { Client: FakeClient, Pool: class {} } };
});

import { cleanupTestDbs } from '../../scripts/cleanup-test-dbs';
import { __resetRevealPasswordCacheForTests } from '../setup/neon-branches';

interface FakeBranch {
  id: string;
  name: string;
  created_at: string;
  endpointHost: string;
  endpointState: string; // 'active' | 'idle' | 'init' | 'none'
}

const NOW = Date.now();
const RECENT = new Date(NOW - 30 * 1000).toISOString();
const OLD = new Date(NOW - 60 * 60 * 1000).toISOString();

let deletedIds: string[];

function installFetch(branches: FakeBranch[]): void {
  const byId = new Map(branches.map((b) => [b.id, b]));
  deletedIds = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((rawUrl: string, init?: RequestInit) => {
      const url = new URL(rawUrl);
      const path = url.pathname;
      const method = (init?.method ?? 'GET').toUpperCase();

      if (method === 'DELETE') {
        const id = path.split('/').pop() ?? '';
        deletedIds.push(id);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (path.endsWith('/branches')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              branches: branches.map((b) => ({
                id: b.id,
                name: b.name,
                created_at: b.created_at,
              })),
            }),
            { status: 200 },
          ),
        );
      }
      const epMatch = path.match(/\/branches\/([^/]+)\/endpoints$/);
      if (epMatch) {
        const b = byId.get(epMatch[1]);
        const endpoints =
          b && b.endpointState !== 'none'
            ? [{ id: `ep_${b.id}`, host: b.endpointHost, type: 'read_write', current_state: b.endpointState }]
            : [];
        return Promise.resolve(new Response(JSON.stringify({ endpoints }), { status: 200 }));
      }
      if (path.endsWith('/reveal_password')) {
        return Promise.resolve(
          new Response(JSON.stringify({ password: 'revealed-secret' }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    }),
  );
}

const ORIG = {
  DATABASE_URL: process.env.DATABASE_URL,
  NEON_API_KEY: process.env.NEON_API_KEY,
  NEON_PROJECT_ID: process.env.NEON_PROJECT_ID,
  DEV_DB_OK: process.env.DEV_DB_OK,
  LV_TEST_USE_NEON_BRANCHES: process.env.LV_TEST_USE_NEON_BRANCHES,
};

describe('connection-aware cross-run sweep (Task #742)', () => {
  beforeEach(() => {
    process.env.DATABASE_URL =
      'postgres://neondb_owner:pw@orig-host.neon.tech/neondb?sslmode=require';
    process.env.NEON_API_KEY = 'k';
    process.env.NEON_PROJECT_ID = 'p1';
    process.env.DEV_DB_OK = '1'; // bypass assertSafeDatabaseHost host allow-list
    process.env.LV_TEST_SWEEP_RECHECK_MS = '0'; // no real delay between probes
    delete process.env.LV_TEST_USE_NEON_BRANCHES;
    state.connByHost.clear();
    state.probeCalls.clear();
    state.failConnectHosts.clear();
    state.connectedHosts = [];
    __resetRevealPasswordCacheForTests();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(ORIG)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reaps idle and zero-connection branches, keeps live ones, regardless of age', async () => {
    const branches: FakeBranch[] = [
      { id: 'br_idle', name: 'test_worker_aaa_pool_1', created_at: RECENT, endpointHost: 'h-idle.neon.tech', endpointState: 'idle' },
      { id: 'br_orphan', name: 'test_worker_bbb_pool_1', created_at: RECENT, endpointHost: 'h-orphan.neon.tech', endpointState: 'active' },
      { id: 'br_live', name: 'test_worker_ccc_pool_1', created_at: RECENT, endpointHost: 'h-live.neon.tech', endpointState: 'active' },
    ];
    state.connByHost.set('h-orphan.neon.tech', 0);
    state.connByHost.set('h-live.neon.tech', 4);
    installFetch(branches);

    const dropped = await cleanupTestDbs({ minAgeMs: 10 * 60 * 1000, connectionAware: true });

    expect(dropped.sort()).toEqual(['test_worker_aaa_pool_1', 'test_worker_bbb_pool_1']);
    expect(deletedIds.sort()).toEqual(['br_idle', 'br_orphan']);
    // The idle branch must NOT be probed (would needlessly wake the compute).
    expect(state.connectedHosts).not.toContain('h-idle.neon.tech');
    // The orphan is probed twice (zero-connection re-confirm); the live
    // branch only once (first probe >0 short-circuits).
    expect(state.probeCalls.get('h-orphan.neon.tech')).toBe(2);
    expect(state.probeCalls.get('h-live.neon.tech')).toBe(1);
  });

  it('keeps a sibling whose connections momentarily drop to zero (double-probe)', async () => {
    const branches: FakeBranch[] = [
      { id: 'br_gap', name: 'test_worker_gap_pool_1', created_at: RECENT, endpointHost: 'h-gap.neon.tech', endpointState: 'active' },
      { id: 'br_orphan', name: 'test_worker_orphan_pool_1', created_at: RECENT, endpointHost: 'h-orphan.neon.tech', endpointState: 'active' },
    ];
    // Sibling: first probe sees a transient gap (0), second sees forks back (5).
    state.connByHost.set('h-gap.neon.tech', [0, 5]);
    // True orphan: zero on both probes.
    state.connByHost.set('h-orphan.neon.tech', [0, 0]);
    installFetch(branches);

    const dropped = await cleanupTestDbs({ minAgeMs: 10 * 60 * 1000, connectionAware: true });

    expect(dropped).toEqual(['test_worker_orphan_pool_1']);
    expect(deletedIds).toEqual(['br_orphan']);
    expect(state.probeCalls.get('h-gap.neon.tech')).toBe(2);
  });

  it('does not fast-delete a branch whose compute state is unknown (probes instead)', async () => {
    const branches: FakeBranch[] = [
      { id: 'br_unknown', name: 'test_worker_unk_pool_1', created_at: RECENT, endpointHost: 'h-unknown.neon.tech', endpointState: 'provisioning' },
    ];
    // Unknown state + live connections → must be KEPT, and must be probed.
    state.connByHost.set('h-unknown.neon.tech', 3);
    installFetch(branches);

    const dropped = await cleanupTestDbs({ minAgeMs: 10 * 60 * 1000, connectionAware: true });

    expect(dropped).toEqual([]);
    expect(deletedIds).toEqual([]);
    expect(state.connectedHosts).toContain('h-unknown.neon.tech');
  });

  it('on probe failure falls back to the age gate (old=delete, young=keep)', async () => {
    const branches: FakeBranch[] = [
      { id: 'br_old', name: 'test_worker_old_pool_1', created_at: OLD, endpointHost: 'h-old.neon.tech', endpointState: 'active' },
      { id: 'br_young', name: 'test_worker_young_pool_1', created_at: RECENT, endpointHost: 'h-young.neon.tech', endpointState: 'active' },
    ];
    state.failConnectHosts.add('h-old.neon.tech');
    state.failConnectHosts.add('h-young.neon.tech');
    installFetch(branches);

    const dropped = await cleanupTestDbs({ minAgeMs: 10 * 60 * 1000, connectionAware: true });

    expect(dropped).toEqual(['test_worker_old_pool_1']);
    expect(deletedIds).toEqual(['br_old']);
  });

  it('without connectionAware, falls back to the pure age gate', async () => {
    const branches: FakeBranch[] = [
      { id: 'br_old', name: 'test_worker_old_pool_1', created_at: OLD, endpointHost: 'h-old.neon.tech', endpointState: 'active' },
      { id: 'br_young', name: 'test_worker_young_pool_1', created_at: RECENT, endpointHost: 'h-young.neon.tech', endpointState: 'active' },
    ];
    installFetch(branches);

    const dropped = await cleanupTestDbs({ minAgeMs: 10 * 60 * 1000 });

    expect(dropped).toEqual(['test_worker_old_pool_1']);
    // Age-gate path never probes computes.
    expect(state.connectedHosts).toEqual([]);
  });
});
