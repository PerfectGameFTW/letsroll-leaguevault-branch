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
 *   The API returns an endpoint hostname per branch; we reuse the
 *   role/password/db from the calling process's existing
 *   `DATABASE_URL` (Neon roles are project-scoped — the same password
 *   works for every branch in the project). This avoids logging the
 *   API-returned `connection_uris` payload (which contains the
 *   plaintext password) and means we never need to call the
 *   `reveal_password` endpoint.
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

export const PRODUCTION_BRANCH_NAME =
  process.env.LV_PRODUCTION_BRANCH_NAME ?? 'production';

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
 * endpoint host with the role/password/db from the calling process's
 * `DATABASE_URL`. Neon roles are project-scoped, so the same
 * credentials work against every branch.
 *
 * Pass `pooled: false` (default) for the worker-DB URL — tests
 * frequently use `pg_advisory_lock` (and `installDbInvariants` does
 * too), and PgBouncer transaction-mode pooling silently breaks
 * session-scoped advisory locks. A direct connection avoids the
 * footgun. The dev/prod app paths still use pooled URLs through
 * their own `DATABASE_URL`.
 */
export function buildBranchUrl(endpointHost: string, baseDatabaseUrl?: string): string {
  const base = baseDatabaseUrl ?? process.env.DATABASE_URL;
  if (!base) {
    throw new Error('buildBranchUrl: DATABASE_URL must be set to derive role/password');
  }
  const u = new URL(base);
  // Strip "-pooler" suffix if present so we get the direct endpoint
  // for advisory-lock-safe connections. The endpoint host the API
  // returns is always the direct host; we just normalise the input.
  u.hostname = endpointHost.replace('-pooler.', '.');
  u.port = '';
  return u.toString();
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
  const url = buildBranchUrl(endpoint.host);
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
  if (!ep?.host) {
    throw new Error(`resolveBranchUrl: branch ${branchId} has no read_write endpoint`);
  }
  return buildBranchUrl(ep.host);
}

let cachedTemplateBranchId: string | null = null;

export async function getTemplateBranch(cfg: NeonConfig): Promise<NeonBranch> {
  const branch = await findBranchByName(cfg, TEMPLATE_BRANCH_NAME);
  if (!branch) {
    throw new Error(
      `Neon template branch "${TEMPLATE_BRANCH_NAME}" not found in project. ` +
        `Create it from "${PRODUCTION_BRANCH_NAME}" in the Neon console (or ` +
        `set LV_TEST_TEMPLATE_BRANCH_NAME).`,
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
