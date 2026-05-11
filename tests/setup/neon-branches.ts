/**
 * Neon Branches API wrapper for test-DB cloning (Task #723).
 *
 * Replaces the legacy `CREATE DATABASE … TEMPLATE` per-pool clone flow
 * with Neon control-plane branch creation. On bad-Neon-control-plane
 * days the legacy flow's `precloneAllWorkerDbs` bucket spent ~358s
 * fighting 55006 "source database is being accessed by other users"
 * retries; branch creation is a single API call (~1-2s per branch)
 * and can be parallelised because branches don't share the
 * source-DB lock that CREATE DATABASE TEMPLATE requires.
 *
 * MUST remain side-effect-free at import time (no top-level await,
 * no spawning, no DB connections). Imported by `clone-template.ts`,
 * `scripts/build-test-template.ts`, and `scripts/cleanup-test-dbs.ts`.
 *
 * Activation:
 *   - `NEON_API_KEY` and `NEON_PROJECT_ID` env vars must both be set.
 *   - `LV_TEST_USE_NEON_BRANCHES=0` opts out (forces legacy CREATE
 *     DATABASE TEMPLATE path even when API creds are present).
 *
 * Connection-URL construction:
 *   The API returns an endpoint hostname per branch. The role name
 *   and db segments come from the calling process's existing
 *   `DATABASE_URL` (the role name and db are the same on every
 *   branch in the project). The **password**, however, is fetched
 *   per branch from the control-plane reveal-password endpoint
 *   (`GET /projects/{p}/branches/{b}/roles/{role}/reveal_password`).
 *   We used to assume `DATABASE_URL`'s password worked on every
 *   branch (Neon role passwords are notionally project-scoped), but
 *   in practice the per-compute SCRAM verifier on a long-suspended
 *   parent compute can lag a project-wide password rotation. Any
 *   branch created from that parent inherits the stale verifier, so
 *   opening a `pg.Pool` against the worker-branch URL with
 *   `DATABASE_URL`'s current password fails 28P01 (Task #727).
 *   Calling `reveal_password` per branch and composing the URL with
 *   the verifier-correct value sidesteps this entirely and makes the
 *   test infra robust to any future password drift. The reveal
 *   response is treated as a secret — never logged, never echoed in
 *   error messages.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const API_BASE = 'https://console.neon.tech/api/v2';

export interface NeonConfig {
  apiKey: string;
  projectId: string;
}

export interface NeonBranch {
  id: string;
  name: string;
  parent_id?: string;
  current_state?: string;
  expires_at?: string | null;
  /** ISO-8601 timestamp; populated by GET /branches and POST /branches. */
  created_at?: string;
}

export interface NeonEndpoint {
  id: string;
  host: string;
  type: string;
  current_state?: string;
}

interface CreateBranchResponse {
  branch: NeonBranch;
  endpoints?: NeonEndpoint[];
}

export const TEMPLATE_BRANCH_NAME =
  process.env.LV_TEST_TEMPLATE_BRANCH_NAME ?? 'LeagueVault_Test_Template';

/**
 * Name of the Neon branch the test template is parented to.
 *
 * Defaults to `main` (Neon's modern default) instead of `production`
 * so that a fresh checkout never silently clones production data into
 * test branches (a foot-gun: production data → template branch → all
 * worker branches → test logs / fixtures, with the corresponding PII
 * exposure surface). Override via `LV_TEST_TEMPLATE_PARENT_BRANCH` for
 * projects whose default branch is named differently.
 *
 * `LV_PRODUCTION_BRANCH_NAME` is kept as a deprecated fallback so
 * existing `.env` files don't break; setting it logs a one-time
 * deprecation warning at first read (see `getResolvedTemplateParent`).
 * Direct readers of this constant get the resolved value.
 */
export const TEMPLATE_PARENT_BRANCH_NAME =
  process.env.LV_TEST_TEMPLATE_PARENT_BRANCH
  ?? process.env.LV_PRODUCTION_BRANCH_NAME
  ?? 'main';

/** @deprecated Use TEMPLATE_PARENT_BRANCH_NAME. Kept for backward compat. */
export const PRODUCTION_BRANCH_NAME = TEMPLATE_PARENT_BRANCH_NAME;

let _deprecationLogged = false;
/**
 * Resolve the template parent branch with a "main → production" fallback
 * for projects where neither env var is set and the Neon project still
 * uses the legacy `production` default-branch name. Returns the branch
 * we should parent the template off, or throws with a clear message if
 * neither candidate exists.
 *
 * Callers that just want the configured name (without API probing)
 * should read `TEMPLATE_PARENT_BRANCH_NAME` directly.
 */
export async function resolveTemplateParentBranch(
  cfg: NeonConfig,
): Promise<NeonBranch> {
  const explicit = process.env.LV_TEST_TEMPLATE_PARENT_BRANCH
    ?? process.env.LV_PRODUCTION_BRANCH_NAME;
  if (process.env.LV_PRODUCTION_BRANCH_NAME && !_deprecationLogged) {
    _deprecationLogged = true;
    console.warn(
      '[neon-branches] LV_PRODUCTION_BRANCH_NAME is deprecated; ' +
        'rename to LV_TEST_TEMPLATE_PARENT_BRANCH for clearer intent.',
    );
  }
  if (explicit) {
    const b = await findBranchByName(cfg, explicit);
    if (!b) {
      throw new Error(
        `[neon-branches] configured template parent branch "${explicit}" not found in Neon project.`,
      );
    }
    return b;
  }
  // No explicit env var. Try `main` first (modern Neon default), then
  // fall back to `production` (legacy default) with a warning so the
  // user knows to set the env var explicitly.
  const main = await findBranchByName(cfg, 'main');
  if (main) return main;
  const prod = await findBranchByName(cfg, 'production');
  if (prod) {
    console.warn(
      '[neon-branches] no `main` branch; falling back to `production` as template parent. ' +
        'Set LV_TEST_TEMPLATE_PARENT_BRANCH=production to silence this warning.',
    );
    return prod;
  }
  throw new Error(
    '[neon-branches] could not find a template parent branch (tried `main`, `production`). ' +
      'Set LV_TEST_TEMPLATE_PARENT_BRANCH to the correct branch name.',
  );
}

export const WORKER_BRANCH_PREFIX = 'test_worker_';

export function getNeonConfig(): NeonConfig | null {
  if (process.env.LV_TEST_USE_NEON_BRANCHES === '0') return null;
  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!apiKey || !projectId) return null;
  return { apiKey, projectId };
}

async function neonRequest<T = unknown>(
  cfg: NeonConfig,
  method: string,
  path: string,
  body?: unknown,
  retries = 4,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status === 423 || res.status === 429 || res.status >= 500) {
        const text = await res.text().catch(() => '');
        throw new Error(`Neon API ${method} ${path} → ${res.status} (retryable): ${text}`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Neon API ${method} ${path} → ${res.status}: ${text}`);
      }
      // 204 No Content (DELETE) returns empty body
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return text ? (JSON.parse(text) as T) : (undefined as T);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(500 * attempt);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function listBranches(cfg: NeonConfig): Promise<NeonBranch[]> {
  const r = await neonRequest<{ branches: NeonBranch[] }>(
    cfg,
    'GET',
    `/projects/${cfg.projectId}/branches`,
  );
  return r.branches ?? [];
}

export async function findBranchByName(
  cfg: NeonConfig,
  name: string,
): Promise<NeonBranch | null> {
  const branches = await listBranches(cfg);
  return branches.find((b) => b.name === name) ?? null;
}

export async function getBranchEndpoints(
  cfg: NeonConfig,
  branchId: string,
): Promise<NeonEndpoint[]> {
  const r = await neonRequest<{ endpoints: NeonEndpoint[] }>(
    cfg,
    'GET',
    `/projects/${cfg.projectId}/branches/${branchId}/endpoints`,
  );
  return r.endpoints ?? [];
}

export async function deleteBranch(cfg: NeonConfig, branchId: string): Promise<void> {
  await neonRequest(cfg, 'DELETE', `/projects/${cfg.projectId}/branches/${branchId}`);
}

/**
 * Build a connection URL for a branch by composing the API-returned
 * endpoint host with the role/db from the calling process's
 * `DATABASE_URL` and an explicit `password` (typically the value
 * returned by `revealEndpointPassword` for the branch's endpoint).
 *
 * The `password` parameter exists because Neon role passwords are
 * notionally project-scoped but the per-compute SCRAM verifier on a
 * long-suspended parent compute can lag a project-wide rotation —
 * any branch created from that parent then rejects `DATABASE_URL`'s
 * current password with 28P01 (Task #727). Callers who really do
 * want to reuse `DATABASE_URL`'s password (e.g. unit tests, or
 * legacy code paths) may omit `password` to fall back to it.
 *
 * The returned URL uses the **direct** endpoint host (we strip any
 * `-pooler` suffix) — tests frequently use `pg_advisory_lock` (and
 * `installDbInvariants` does too), and PgBouncer transaction-mode
 * pooling silently breaks session-scoped advisory locks.
 */
export function buildBranchUrl(
  endpointHost: string,
  password?: string,
  baseDatabaseUrl?: string,
): string {
  const base = baseDatabaseUrl ?? process.env.DATABASE_URL;
  if (!base) {
    throw new Error('buildBranchUrl: DATABASE_URL must be set to derive role/db');
  }
  const u = new URL(base);
  // Strip "-pooler" suffix if present so we get the direct endpoint
  // for advisory-lock-safe connections. The endpoint host the API
  // returns is always the direct host; we just normalise the input.
  u.hostname = endpointHost.replace('-pooler.', '.');
  u.port = '';
  if (password !== undefined) {
    // Neon passwords are URL-safe in practice, but `URL.password`
    // setter percent-encodes anything that isn't, which is the
    // correct behaviour for `pg.Pool({ connectionString })`.
    u.password = password;
  }
  return u.toString();
}

/**
 * Per-`(branchId, roleName)` cache of revealed passwords. Lifetime
 * is the calling process — both the main vitest process (preclone)
 * and each spawned worker fork keep their own cache. Worker forks
 * inherit the per-pool URL (already containing the password) via
 * `process.env`, so they generally don't need to call this at all.
 */
const revealCache = new Map<string, Promise<string>>();

/** Extract the SQL role name from a Postgres connection URL. */
function roleFromUrl(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  const role = decodeURIComponent(u.username);
  if (!role) {
    throw new Error('reveal_password: DATABASE_URL has no role/user segment');
  }
  return role;
}

/**
 * Fetch the actual password the branch's compute will accept for the
 * given role. Memoised per `(branchId, roleName)` for the calling
 * process. Treats the response as a secret — never logged, never
 * included verbatim in error messages.
 */
export async function revealBranchRolePassword(
  cfg: NeonConfig,
  branchId: string,
  roleName: string,
): Promise<string> {
  const key = `${branchId}/${roleName}`;
  const cached = revealCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const r = await neonRequest<{ password: string }>(
        cfg,
        'GET',
        `/projects/${cfg.projectId}/branches/${branchId}/roles/${encodeURIComponent(
          roleName,
        )}/reveal_password`,
      );
      if (!r || typeof r.password !== 'string' || r.password.length === 0) {
        throw new Error('empty body');
      }
      return r.password;
    } catch (err) {
      // Drop the cached failed promise so the next caller can retry,
      // and surface a generic message that doesn't echo any payload
      // Neon may have returned (which could include the password on
      // a partial/malformed response).
      revealCache.delete(key);
      const code = err instanceof Error ? err.message.split(':')[0] : 'unknown';
      throw new Error(
        `could not reveal password for branch ${branchId} role ${roleName} (${code})`,
      );
    }
  })();
  revealCache.set(key, promise);
  return promise;
}

/** Test-only hook to clear the reveal cache between cases. */
export function __resetRevealPasswordCacheForTests(): void {
  revealCache.clear();
}

export interface CreatedBranch {
  branchId: string;
  endpointId: string;
  endpointHost: string;
  url: string;
}

export async function createBranchWithEndpoint(
  cfg: NeonConfig,
  parentBranchId: string,
  name: string,
): Promise<CreatedBranch> {
  const t0 = Date.now();
  const result = await neonRequest<CreateBranchResponse>(
    cfg,
    'POST',
    `/projects/${cfg.projectId}/branches`,
    {
      branch: { parent_id: parentBranchId, name },
      endpoints: [{ type: 'read_write' }],
    },
  );
  const endpoint = result.endpoints?.[0];
  if (!endpoint?.host || !endpoint.id) {
    throw new Error(`createBranch ${name}: API returned no endpoint host/id`);
  }
  const role = roleFromUrl(process.env.DATABASE_URL ?? '');
  const password = await revealBranchRolePassword(cfg, result.branch.id, role);
  const url = buildBranchUrl(endpoint.host, password);
  console.log(
    `[lv-perf] neon createBranch name=${name} branchId=${result.branch.id}` +
      ` endpoint=${endpoint.id} state=${result.branch.current_state ?? '?'}` +
      ` total=${Date.now() - t0}ms`,
  );
  return {
    branchId: result.branch.id,
    endpointId: endpoint.id,
    endpointHost: endpoint.host,
    url,
  };
}

/**
 * Resolve an existing branch to its first read_write endpoint URL.
 * Used when build-test-template wants to operate against the
 * persistent template branch without recreating it (idempotent
 * fast path) and when cloneTemplateForWorker finds an existing
 * worker branch from a previous attempt.
 */
export async function resolveBranchUrl(cfg: NeonConfig, branchId: string): Promise<string> {
  const endpoints = await getBranchEndpoints(cfg, branchId);
  const ep = endpoints.find((e) => e.type === 'read_write');
  if (!ep?.host || !ep.id) {
    throw new Error(`resolveBranchUrl: branch ${branchId} has no read_write endpoint`);
  }
  const role = roleFromUrl(process.env.DATABASE_URL ?? '');
  const password = await revealBranchRolePassword(cfg, branchId, role);
  return buildBranchUrl(ep.host, password);
}

let cachedTemplateBranchId: string | null = null;

export async function getTemplateBranch(cfg: NeonConfig): Promise<NeonBranch> {
  const branch = await findBranchByName(cfg, TEMPLATE_BRANCH_NAME);
  if (!branch) {
    throw new Error(
      `Neon template branch "${TEMPLATE_BRANCH_NAME}" not found in project. ` +
        `Run \`tsx scripts/build-test-template.ts\` to create it (or ` +
        `set LV_TEST_TEMPLATE_BRANCH_NAME if it has a different name).`,
    );
  }
  cachedTemplateBranchId = branch.id;
  return branch;
}

export async function getTemplateBranchId(cfg: NeonConfig): Promise<string> {
  if (cachedTemplateBranchId) return cachedTemplateBranchId;
  const b = await getTemplateBranch(cfg);
  return b.id;
}

/**
 * Neon refuses to create child branches from a parent that has an
 * `expires_at` set ("Branches with an expiration date cannot have
 * child branches"). The user's template branch was inadvertently
 * created with the project's default 24h TTL; clear it idempotently
 * so the build is robust to future re-creations.
 */
export async function ensureBranchPersistent(
  cfg: NeonConfig,
  branchId: string,
): Promise<void> {
  await neonRequest(
    cfg,
    'PATCH',
    `/projects/${cfg.projectId}/branches/${branchId}`,
    { branch: { expires_at: null } },
  );
}
