import type { Request } from 'express';
import { createLogger } from '../logger';

const log = createLogger('BowlerClaimTokens');

/**
 * Ephemeral creation-time claim registry for the bowler-leagues bootstrap
 * path (see `server/routes/bowler-leagues.ts`).
 *
 * Why this exists
 * ---------------
 * Bowler rows in the database have no owning-organization column today
 * (tracked as a separate follow-up). That means once a bowler exists, any
 * org admin who knows the id can call POST /api/bowler-leagues with their
 * own org's league/team and "claim" the bowler — because hasAccessToBowler
 * also resolves through the leagues we're about to attach. To prevent
 * cross-org hijacks of brand-new bowlers in the window between bowler
 * creation and first link, the bootstrap branch in the route requires a
 * matching claim token here:
 *
 *   POST /api/bowlers           → registerBowlerClaim(id, req)
 *   POST /api/bowler-leagues    → consumeBowlerClaim(id, req) MUST be true
 *                                 before the bootstrap link is allowed.
 *
 * Properties
 * ----------
 * - Token stores the creator's user id and org id; consume requires both
 *   to match the consuming caller. So an org-A admin cannot consume a
 *   token registered by an org-B admin even if they somehow obtained the
 *   bowler id.
 * - Tokens expire after `TTL_MS` (10 minutes) — long enough for normal
 *   "create bowler then attach to team" UI flows, short enough that a
 *   stale token doesn't outlive its purpose.
 * - Tokens are single-use: a successful consume removes the entry, so the
 *   bootstrap path can be exercised at most once per registered bowler.
 * - Storage is process-local (in-memory `Map`). This is intentional for
 *   the temporary safeguard; the long-term fix is the owning-organization
 *   column on bowlers, after which this module can be deleted.
 */

interface ClaimToken {
  userId: number;
  orgId: number | null;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const tokens = new Map<number, ClaimToken>();

let cleanupTimer: NodeJS.Timeout | null = null;

function ensureCleanupRunning(): void {
  if (cleanupTimer !== null) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [bowlerId, token] of tokens) {
      if (token.expiresAt <= now) tokens.delete(bowlerId);
    }
  }, 60_000);
  // Don't keep the event loop alive just for cleanup — process exit
  // (incl. test runners) should not be blocked.
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

function getRequestUser(req: Request): { id: number; organizationId: number | null } | null {
  const u = req.user as { id?: unknown; organizationId?: unknown } | undefined;
  if (!u || typeof u.id !== 'number') return null;
  const orgId = typeof u.organizationId === 'number' ? u.organizationId : null;
  return { id: u.id, organizationId: orgId };
}

/**
 * Register a fresh-bowler claim token bound to the authenticated user
 * who created the row. Idempotent — overwrites any prior token for the
 * same bowler id. Silently does nothing for unauthenticated calls
 * (which should never happen via the route, but we don't want to crash
 * a successful create over a token-bookkeeping edge case).
 */
export function registerBowlerClaim(bowlerId: number, req: Request): void {
  ensureCleanupRunning();
  const u = getRequestUser(req);
  if (!u) return;
  tokens.set(bowlerId, {
    userId: u.id,
    orgId: u.organizationId,
    expiresAt: Date.now() + TTL_MS,
  });
  log.debug(`registered bowler claim: bowler=${bowlerId} user=${u.id} org=${u.organizationId ?? 'null'}`);
}

/**
 * Returns true (and removes the token) when there is a non-expired
 * claim for `bowlerId` whose creator matches the authenticated caller
 * by both userId and organizationId. Returns false otherwise. Never
 * leaks why the consume failed — the route maps every false to the
 * same generic 403 to avoid an oracle.
 */
export function consumeBowlerClaim(bowlerId: number, req: Request): boolean {
  const token = tokens.get(bowlerId);
  if (!token) return false;
  if (token.expiresAt <= Date.now()) {
    tokens.delete(bowlerId);
    return false;
  }
  const u = getRequestUser(req);
  if (!u) return false;
  if (token.userId !== u.id) return false;
  if (token.orgId !== u.organizationId) return false;
  tokens.delete(bowlerId);
  return true;
}

/**
 * Test-only helper: drop all in-memory tokens. Used by unit and
 * integration tests that need a clean baseline.
 */
export function __resetBowlerClaimsForTests(): void {
  tokens.clear();
}
