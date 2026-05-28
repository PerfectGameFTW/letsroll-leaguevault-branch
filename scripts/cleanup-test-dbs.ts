/**
 * Drop any leftover per-worker test databases / branches (Task #699 +
 * Task #723).
 *
 * Two cleanup backends, mirroring the two cloning backends:
 *
 *   1. **Neon Branches API** (Task #723) — when `NEON_API_KEY` and
 *      `NEON_PROJECT_ID` are set, lists every branch whose name
 *      starts with `test_worker_` and deletes it via API. No
 *      advisory-lock dance is needed (Neon serialises branch
 *      operations on its control plane). The cross-run startup sweep
 *      additionally opts into a **connection-aware** safety rail
 *      (`connectionAware`, Task #742): it probes each branch's compute
 *      for live client connections and only deletes branches with zero
 *      active computes/connections (crashed-run orphans), never a
 *      concurrently-running sibling vitest process's live branch. The
 *      end-of-run RUN_ID-scoped cleanup skips the probe and deletes its
 *      own branches unconditionally.
 *
 *   2. **Legacy CREATE DATABASE TEMPLATE** — drops `test_worker_%`
 *      databases on the dev host under the same advisory lock
 *      `cloneTemplate()` uses, with the in-use skip safeguard
 *      preserved from #722.
 *
 * Match pattern: `test_worker_*` (branch names) / `test_worker_%` (DB
 * names). Refuses to run unless the dev-DB allow-list rail accepts
 * the connected host (covers both modes — even in Neon-branches mode
 * we don't want this script to talk to a project whose dev URL isn't
 * the registered dev host).
 */
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { assertSafeDatabaseHost } from '../server/utils/db-safety';
import { CLONE_ADVISORY_LOCK_KEY } from '../tests/setup/per-worker-lock';
import {
  deleteBranch,
  getBranchEndpoints,
  getNeonConfig,
  listBranches,
  resolveBranchUrl,
  WORKER_BRANCH_PREFIX,
  type NeonBranch,
  type NeonConfig,
} from '../tests/setup/neon-branches';

/**
 * A Neon endpoint counts as "live" (a run might be using it) while its
 * compute is running or spinning up. An `idle` compute is suspended:
 * by definition it has zero active connections, so the parent branch is
 * safe to delete without even opening a connection (which would
 * needlessly wake the compute).
 */
function endpointIsLive(state: string | undefined): boolean {
  return state === 'active' || state === 'init';
}

/**
 * Count non-self client connections on a branch's compute. Only ever
 * called for branches that already have a *live* compute, so this never
 * wakes a suspended compute. A killed test run leaves its compute warm
 * for the suspend-timeout window but with zero client connections — this
 * is how we distinguish "my own crashed-run orphan" (0 conns, delete it
 * now) from "an actively-running sibling vitest process" (N conns, keep).
 */
async function countBranchClientConnections(
  cfg: NeonConfig,
  branch: NeonBranch,
): Promise<number> {
  const url = await resolveBranchUrl(cfg, branch.id);
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 6000,
    statement_timeout: 5000,
  });
  try {
    await client.connect();
    const { rows } = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM pg_stat_activity
       WHERE pid <> pg_backend_pid() AND backend_type = 'client backend'`,
    );
    return rows[0]?.c ?? 0;
  } finally {
    await client.end().catch(() => {});
  }
}

function branchOlderThan(branch: NeonBranch, minAgeMs: number | undefined): boolean {
  if (minAgeMs === undefined || minAgeMs <= 0) return false;
  const created = branch.created_at ? Date.parse(branch.created_at) : 0;
  return created > 0 && created < Date.now() - minAgeMs;
}

interface BranchDecision {
  delete: boolean;
  reason: string;
}

/**
 * Delay between the two zero-connection probes (see below). Overridable
 * via `LV_TEST_SWEEP_RECHECK_MS` so unit tests can drive it to 0.
 */
const ZERO_CONN_RECHECK_MS = Number(process.env.LV_TEST_SWEEP_RECHECK_MS ?? '1500');

/**
 * Connection-aware deletion decision for the cross-run startup sweep.
 *
 * Deletes a branch iff it has **zero active Neon computes** (every
 * endpoint positively reports idle, or there is no endpoint at all) OR a
 * live compute that shows **zero client connections across two probes** —
 * i.e. a warm crashed-run orphan. A branch with live client connections
 * is an actively-running sibling vitest process and is never deleted.
 *
 * Safety choices (Task #742 review hardening):
 *   - Only a compute we can *positively confirm* is idle/suspended takes
 *     the no-probe fast-delete path. Any other state — active, init, or a
 *     missing/unknown value Neon may return on a partial payload — is
 *     treated as "possibly live" and probed, so we never fast-delete a
 *     branch whose compute state we couldn't actually read.
 *   - A zero-connection reading is re-confirmed after a short delay before
 *     deleting. A genuine orphan stays at zero across both probes; a
 *     sibling that is merely *between* connections (fork recycle between
 *     files under `isolate: true`, or its own globalSetup startup gap)
 *     reconnects and trips the second probe, so its transient
 *     zero-connection window does not get it deleted.
 *   - On probe failure (network blip, password drift) we fall back to the
 *     age gate: delete only if the branch is genuinely old, otherwise keep.
 *
 * This still samples connection state rather than holding a cross-run
 * lease, so an absolute "never delete a live sibling" guarantee against a
 * pathological multi-second connection gap would require a branch-ownership
 * heartbeat/lease model (deliberately not built here). The double-probe
 * plus end-of-run RUN_ID-scoped cleanup and the manual sweep script are the
 * backstops for that residual sub-window.
 */
async function classifyBranchForSweep(
  cfg: NeonConfig,
  branch: NeonBranch,
  minAgeMs: number | undefined,
): Promise<BranchDecision> {
  const endpoints = await getBranchEndpoints(cfg, branch.id);
  // No endpoint at all → no compute exists → safe to delete.
  if (endpoints.length === 0) {
    return { delete: true, reason: 'no-endpoint' };
  }
  // Fast-delete only when every endpoint is *confirmed* idle/suspended
  // (idle ⇒ zero connections by definition, so no probe needed and we
  // don't needlessly wake the compute). Unknown/missing states do NOT
  // qualify and fall through to the probe.
  const allConfirmedIdle = endpoints.every(
    (e) => e.current_state === 'idle' && !endpointIsLive(e.pending_state),
  );
  if (allConfirmedIdle) {
    return { delete: true, reason: 'all-computes-idle' };
  }
  try {
    const first = await countBranchClientConnections(cfg, branch);
    if (first > 0) {
      return { delete: false, reason: `in-use-${first}-conns` };
    }
    // Re-confirm zero before deleting, to ride out a sibling's transient
    // between-connections window.
    await sleep(ZERO_CONN_RECHECK_MS);
    const second = await countBranchClientConnections(cfg, branch);
    if (second > 0) {
      return { delete: false, reason: `in-use-${second}-conns-recheck` };
    }
    return { delete: true, reason: 'live-compute-0-conns-x2' };
  } catch (err) {
    const code = err instanceof Error ? err.message.split(':')[0] : 'unknown';
    if (branchOlderThan(branch, minAgeMs)) {
      return { delete: true, reason: `probe-failed-old (${code})` };
    }
    return { delete: false, reason: `probe-failed-young (${code})` };
  }
}

function adminDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL must be set to clean up test worker databases.');
  }
  const u = new URL(raw);
  u.pathname = '/postgres';
  return u.toString();
}

async function cleanupViaNeonBranches(
  branchNamePrefix?: string,
  minAgeMs?: number,
  connectionAware?: boolean,
): Promise<string[]> {
  const cfg = getNeonConfig();
  if (!cfg) throw new Error('cleanupViaNeonBranches called without Neon config');
  const tStart = Date.now();
  const branches = await listBranches(cfg);
  // Default: every branch under the WORKER_BRANCH_PREFIX (the cross-run
  // sweep used at globalSetup start and by the manual entrypoint).
  // Caller-supplied: only branches under the current LV_TEST_RUN_ID
  // prefix (used at end-of-run cleanup so a concurrently-running
  // sibling vitest process's branches are not deleted).
  const filterPrefix = branchNamePrefix ?? WORKER_BRANCH_PREFIX;
  const candidates = branches.filter((b) => b.name.startsWith(filterPrefix));
  let targets = candidates;
  if (connectionAware) {
    // Connection-aware cross-run sweep (Task #742). Instead of the
    // blunt 10-minute age gate, ask each branch's compute whether it
    // actually has live client connections. A branch with **zero
    // active computes** (idle/suspended) or a warm compute with **zero
    // client connections** is a crashed-run orphan and is reaped
    // immediately, regardless of age. A branch with live connections
    // is an actively-running sibling vitest process and is always
    // kept. `minAgeMs` is retained only as a fallback when the probe
    // can't reach the compute. This is gated to the cross-run sweep
    // (no RUN_ID prefix) — end-of-run cleanup passes a RUN_ID prefix
    // and must delete its own still-warm branches unconditionally.
    const kept: string[] = [];
    const decisions = await Promise.all(
      candidates.map(async (b) => ({
        branch: b,
        decision: await classifyBranchForSweep(cfg, b, minAgeMs).catch(
          (err): BranchDecision => ({
            delete: branchOlderThan(b, minAgeMs),
            reason: `classify-error (${err instanceof Error ? err.message.split(':')[0] : 'unknown'})`,
          }),
        ),
      })),
    );
    targets = [];
    for (const { branch, decision } of decisions) {
      if (decision.delete) targets.push(branch);
      else kept.push(`${branch.name} [${decision.reason}]`);
    }
    if (kept.length > 0) {
      console.log(
        `[cleanup-test-dbs] connection-aware sweep kept ${kept.length} live branch(es): ${kept.join(', ')}`,
      );
    }
  } else if (minAgeMs !== undefined && minAgeMs > 0) {
    // Legacy age gate (retained for callers that don't opt into the
    // connection-aware path): skip any branch younger than `minAgeMs`
    // so an active sibling run (whose branches were created seconds
    // ago) is never touched while older crashed-run leftovers are
    // still swept.
    const cutoff = Date.now() - minAgeMs;
    const before = targets.length;
    targets = targets.filter((b) => {
      const created = b.created_at ? Date.parse(b.created_at) : 0;
      return created > 0 && created < cutoff;
    });
    if (before !== targets.length) {
      console.log(
        `[cleanup-test-dbs] age-gate (minAgeMs=${minAgeMs}) skipped ${before - targets.length} young branch(es)`,
      );
    }
  }
  const dropped: string[] = [];
  const failed: string[] = [];
  // Parallel deletes — Neon serialises operations on the parent
  // (template) branch internally, but branch *deletions* don't
  // interact with each other.
  await Promise.all(
    targets.map(async (b) => {
      try {
        await deleteBranch(cfg, b.id);
        dropped.push(b.name);
      } catch (err) {
        failed.push(`${b.name} (${err instanceof Error ? err.message : String(err)})`);
      }
    }),
  );
  if (failed.length > 0) {
    console.warn(
      `[cleanup-test-dbs] failed to delete ${failed.length} branch(es): ${failed.join('; ')}`,
    );
  }
  console.log(
    `[lv-perf] cleanupTestDbs mode=neon-branches scanned=${branches.length}` +
      ` prefix=${filterPrefix} targets=${targets.length} dropped=${dropped.length}` +
      ` failed=${failed.length} total=${Date.now() - tStart}ms`,
  );
  return dropped;
}

export interface CleanupOptions {
  /**
   * In Neon-branches mode, only delete branches whose names start
   * with this prefix. Defaults to `WORKER_BRANCH_PREFIX`
   * (`test_worker_`), which sweeps all worker branches across runs.
   * Pass `test_worker_<RUN_ID>_` from end-of-run cleanup so a
   * concurrent sibling vitest process's branches are not affected.
   *
   * Has no effect in legacy CREATE-DATABASE-TEMPLATE mode (which
   * already runs under an advisory lock and skips end-of-run
   * teardown).
   */
  branchNamePrefix?: string;
  /**
   * In Neon-branches mode, only delete branches whose `created_at`
   * is older than `minAgeMs` ms ago. Used by the startup cross-run
   * sweep (no `branchNamePrefix`) to leave a concurrently-running
   * sibling vitest process's freshly-created branches alone while
   * still cleaning up older leftovers from crashed runs.
   *
   * Has no effect in legacy mode.
   */
  minAgeMs?: number;
  /**
   * In Neon-branches mode, decide deletion per-branch by probing each
   * branch's compute for live client connections instead of relying on
   * the `minAgeMs` age gate (Task #742). A branch with no active compute
   * (idle/suspended) or a warm compute with zero client connections is a
   * crashed-run orphan and is reaped immediately regardless of age; a
   * branch with live connections is an actively-running sibling vitest
   * process and is always kept. `minAgeMs` is then only a fallback for
   * branches whose compute can't be probed. Used by the startup
   * cross-run sweep. Must NOT be combined with a RUN_ID `branchNamePrefix`
   * (end-of-run cleanup needs to delete its own still-warm branches).
   *
   * Has no effect in legacy mode.
   */
  connectionAware?: boolean;
}

async function cleanupViaCreateDatabase(): Promise<string[]> {
  const tStart = Date.now();
  const adminPool = new pg.Pool({ connectionString: adminDatabaseUrl(), max: 2 });
  const dropped: string[] = [];
  const skipped: string[] = [];
  // Task #722 hardening: hold the same advisory lock that
  // `cloneTemplate()` uses for the entire scan+drop loop so we close
  // the TOCTOU window between the active-conn probe below and the
  // `DROP DATABASE` — without this, a sibling worker can clone a
  // fresh DB into a name we just observed empty and we'll force-drop
  // it out from under them.
  const lockClient = await adminPool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [CLONE_ADVISORY_LOCK_KEY]);
    const { rows } = await adminPool.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'test_worker_%'`,
    );
    for (const { datname } of rows) {
      try {
        const { rows: usage } = await adminPool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [datname],
        );
        const activeConns = Number(usage[0]?.count ?? '0');
        if (activeConns > 0) {
          skipped.push(`${datname} (${activeConns} active conns)`);
          continue;
        }
        await adminPool.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
        dropped.push(datname);
      } catch (err) {
        console.error(`[cleanup-test-dbs] failed to drop ${datname}:`, err);
      }
    }
    if (skipped.length > 0) {
      console.warn(
        `[cleanup-test-dbs] skipped ${skipped.length} in-use DB(s): ${skipped.join(', ')}`,
      );
    }
    console.log(
      `[lv-perf] cleanupTestDbs mode=legacy scanned=${rows.length} dropped=${dropped.length}` +
        ` skipped=${skipped.length} total=${Date.now() - tStart}ms`,
    );
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [CLONE_ADVISORY_LOCK_KEY]);
    } catch { /* noop */ }
    lockClient.release();
    await adminPool.end();
  }
  return dropped;
}

export async function cleanupTestDbs(opts: CleanupOptions = {}): Promise<string[]> {
  assertSafeDatabaseHost('cleanup-test-dbs');
  if (getNeonConfig()) {
    return cleanupViaNeonBranches(opts.branchNamePrefix, opts.minAgeMs, opts.connectionAware);
  }
  return cleanupViaCreateDatabase();
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  cleanupTestDbs()
    .then((dropped) => {
      if (dropped.length === 0) {
        console.log('[cleanup-test-dbs] no leftover test_worker_* targets.');
      } else {
        console.log(`[cleanup-test-dbs] dropped ${dropped.length}: ${dropped.join(', ')}`);
      }
    })
    .catch((err) => {
      console.error('[cleanup-test-dbs] failed:', err);
      process.exit(1);
    });
}
