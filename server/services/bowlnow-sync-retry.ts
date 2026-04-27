/**
 * Background sweep that retries failed BowlNow contact syncs (task #480).
 *
 * Mirror of `server/services/payment-sync-retry.ts` for the BowlNow side.
 * `bowler-resync.ts` fires `syncBowlerToBN` fire-and-forget on every
 * bowler-league mutation and on profile edits; before #480 a transient
 * BowlNow 5xx (or rate-limit blip) silently left the bowler's contact
 * record stale until the next manual sync-all. This sweep walks every
 * bowler whose last BowlNow sync failed (`bn_sync_pending_at IS NOT
 * NULL`) and re-runs `syncBowlerToBN`, with the same exponential
 * backoff + max-attempts shape the payment sweep uses.
 *
 * Why a separate sweep instead of folding into `payment-sync-retry`:
 *   - Square and BowlNow are independent providers with independent
 *     failure modes. Sharing the pending flag would force a Square
 *     success to clear a still-failing BowlNow retry (or vice-versa).
 *   - Each provider gets its own attempt counter so we can tune them
 *     separately if one ends up flakier than the other.
 *   - The wiring (boot/shutdown, locked-sweep, lease-stamp) is
 *     identical, so the duplicated cost is small.
 */
import { and, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { bowlers, BN_SYNC_MAX_ATTEMPTS } from '@shared/schema';
import { storage } from '../storage';
import { createLogger } from '../logger';
import { lockedSweep } from './_internal/locked-sweep';
import { syncBowlerToBN, isOrgBNConfigured } from './bowlnow';

const log = createLogger('BowlnowSyncRetry');

// Tick interval. Same shape as payment-sync-retry — independent of
// per-bowler backoff, so a short interval just means faster pickup
// once a bowler's backoff window closes.
const SWEEP_INTERVAL_MS = 5 * 60_000;

// Exponential backoff anchored at the most recent retry attempt:
//   attempts=0 → 1m, 1 → 2m, 2 → 4m, 3 → 8m, 4 → 16m
// Same curve as the payment sweep. `attempts` here is the count
// *before* the next retry; once it hits `BN_SYNC_MAX_ATTEMPTS` we
// stop trying altogether.
const BASE_BACKOFF_MS = 60_000;

export function bnSyncBackoffMs(attempts: number): number {
  const safe = Math.max(0, Math.min(attempts, 16));
  return BASE_BACKOFF_MS * Math.pow(2, safe);
}

export interface BnSweepResult {
  scanned: number;
  retried: number;
  succeeded: number;
  pendingAgain: number;
  skippedBackoff: number;
  /**
   * Bowler had a pending flag but their org no longer has BowlNow
   * configured (admin disabled / removed credentials). Retrying would
   * be a no-op forever, so the sweep CLEARS the flag for these rows
   * and counts them here. Mirrors the `skippedNoUser` semantics in
   * the payment sweep.
   */
  skippedNoConfig: number;
  skippedMaxAttempts: number;
  errors: number;
  skippedByLock: number;
}

export async function runBowlnowSyncRetrySweep(now: Date = new Date()): Promise<BnSweepResult> {
  const result: BnSweepResult = {
    scanned: 0,
    retried: 0,
    succeeded: 0,
    pendingAgain: 0,
    skippedBackoff: 0,
    skippedNoConfig: 0,
    skippedMaxAttempts: 0,
    errors: 0,
    skippedByLock: 0,
  };

  // Backoff math mirrors bnSyncBackoffMs:
  //   dueAt = bn_sync_last_attempt_at + 60s * 2 ^ LEAST(attempts, 16)
  // LEAST clamps the exponent so an absurd attempt count can't
  // overflow the interval arithmetic.
  const backoffEligible = sql`(
    ${bowlers.bnSyncLastAttemptAt} IS NULL
    OR ${bowlers.bnSyncLastAttemptAt} + (interval '60 seconds' * power(2, LEAST(${bowlers.bnSyncAttempts}, 16))) <= NOW()
  )`;

  // `and(...)` returns `SQL | undefined` because zero non-undefined
  // args would mean "no filter". All three args here are concrete
  // expressions, so the result is always defined — assign through an
  // explicit narrowing to keep that contract typed without a `!`.
  const conditionsMaybe = and(
    isNotNull(bowlers.bnSyncPendingAt),
    lt(bowlers.bnSyncAttempts, BN_SYNC_MAX_ATTEMPTS),
    backoffEligible,
  );
  if (!conditionsMaybe) {
    throw new Error(
      "bowlnow-sync-retry: drizzle and(...) returned undefined despite all-defined args (unreachable)",
    );
  }
  const conditions = conditionsMaybe;

  const { candidates, skippedByLock } = await db.transaction(async (tx) => {
    // Same lockedSweep + lease-stamp pattern as the payment retry.
    // We stamp `bn_sync_last_attempt_at` to NOW for every locked row
    // before releasing the row lock so a peer worker's next tick
    // can't double-call BowlNow on the same bowler. We deliberately
    // do NOT bump `bn_sync_attempts` here — the per-row update
    // below handles the increment on failure / reset on success.
    const { rows: locked, skippedByLock: skipped } = await lockedSweep(
      tx,
      bowlers,
      conditions,
    );

    if (locked.length > 0) {
      const lockedIds = locked.map((b) => b.id);
      await tx
        .update(bowlers)
        .set({ bnSyncLastAttemptAt: sql`NOW()` })
        .where(inArray(bowlers.id, lockedIds));
    }

    return {
      candidates: locked,
      skippedByLock: skipped,
    };
  });

  if (skippedByLock > 0) {
    log.info('BowlNow-sync retry: rows claimed by another instance', {
      skippedByLock,
      acquired: candidates.length,
    });
  }

  result.skippedByLock = skippedByLock;
  result.scanned = candidates.length;

  for (const bowler of candidates) {
    if ((bowler.bnSyncAttempts ?? 0) >= BN_SYNC_MAX_ATTEMPTS) {
      result.skippedMaxAttempts++;
      continue;
    }

    const lastAttempt = bowler.bnSyncLastAttemptAt
      ? new Date(bowler.bnSyncLastAttemptAt).getTime()
      : null;
    if (lastAttempt !== null) {
      const dueAt = lastAttempt + bnSyncBackoffMs(bowler.bnSyncAttempts ?? 0);
      if (now.getTime() < dueAt) {
        result.skippedBackoff++;
        continue;
      }
    }

    // BowlNow is org-scoped. If the bowler's org no longer has
    // BowlNow configured, retrying will fail forever — clear the
    // flag so we stop scanning the row, and surface it once per
    // tick. Mirrors `skippedNoUser` in the payment sweep, which
    // similarly drops bowlers that can't possibly succeed.
    const orgConfig = bowler.organizationId
      ? await storage.getOrgIntegrations(bowler.organizationId)
      : null;
    if (!isOrgBNConfigured(orgConfig)) {
      log.warn('Clearing BN sync flag: org no longer has BowlNow configured', {
        bowlerId: bowler.id,
        organizationId: bowler.organizationId,
        pendingSince: bowler.bnSyncPendingAt,
        attempts: bowler.bnSyncAttempts,
      });
      try {
        await db
          .update(bowlers)
          .set({
            bnSyncPendingAt: null,
            bnSyncAttempts: 0,
            bnSyncLastAttemptAt: null,
          })
          .where(inArray(bowlers.id, [bowler.id]));
      } catch (err) {
        log.error('Failed to clear BN sync flag for unconfigured org', {
          bowlerId: bowler.id,
          error: err instanceof Error ? { name: err.name, message: err.message } : err,
        });
      }
      result.skippedNoConfig++;
      continue;
    }

    result.retried++;
    let outcome: { success: boolean; error?: string };
    try {
      outcome = await syncBowlerToBN(bowler.id, orgConfig);
    } catch (err) {
      result.errors++;
      log.error('BowlNow-sync retry threw unexpectedly', {
        bowlerId: bowler.id,
        organizationId: bowler.organizationId,
        error: err instanceof Error ? { name: err.name, message: err.message } : err,
      });
      // Treat a thrown error the same as success: false — bump the
      // attempt counter so we eventually give up instead of retrying
      // forever on a permanent failure mode (e.g., a permanently
      // malformed bowler row).
      try {
        await db
          .update(bowlers)
          .set({ bnSyncAttempts: sql`${bowlers.bnSyncAttempts} + 1` })
          .where(inArray(bowlers.id, [bowler.id]));
      } catch (bumpErr) {
        log.error('BowlNow-sync retry: failed to bump attempts after throw', {
          bowlerId: bowler.id,
          error: bumpErr instanceof Error ? { name: bumpErr.name, message: bumpErr.message } : bumpErr,
        });
      }
      continue;
    }

    if (outcome.success) {
      // Clear the flag and reset the attempt counter. Leave
      // `bn_sync_last_attempt_at` as the lease-stamp NOW so the next
      // failure (if any) starts its backoff curve from a known
      // recent timestamp.
      try {
        await db
          .update(bowlers)
          .set({
            bnSyncPendingAt: null,
            bnSyncAttempts: 0,
          })
          .where(inArray(bowlers.id, [bowler.id]));
        result.succeeded++;
      } catch (err) {
        result.errors++;
        log.error('BowlNow-sync retry: succeeded but failed to clear flag', {
          bowlerId: bowler.id,
          error: err instanceof Error ? { name: err.name, message: err.message } : err,
        });
      }
    } else {
      // Bump attempts so the next tick advances the backoff window
      // and the row eventually exits via skippedMaxAttempts.
      try {
        await db
          .update(bowlers)
          .set({ bnSyncAttempts: sql`${bowlers.bnSyncAttempts} + 1` })
          .where(inArray(bowlers.id, [bowler.id]));
        result.pendingAgain++;
        if ((bowler.bnSyncAttempts ?? 0) + 1 >= BN_SYNC_MAX_ATTEMPTS) {
          log.error('BowlNow-sync retry: giving up after max attempts', {
            bowlerId: bowler.id,
            organizationId: bowler.organizationId,
            attempts: (bowler.bnSyncAttempts ?? 0) + 1,
            lastError: outcome.error,
          });
        }
      } catch (err) {
        result.errors++;
        log.error('BowlNow-sync retry: failed to bump attempts', {
          bowlerId: bowler.id,
          error: err instanceof Error ? { name: err.name, message: err.message } : err,
        });
      }
    }
  }

  return result;
}

let sweepInterval: ReturnType<typeof setInterval> | null = null;
let sweepInFlight = false;

export function startBowlnowSyncRetrySweep(intervalMs: number = SWEEP_INTERVAL_MS): void {
  stopBowlnowSyncRetrySweep();
  log.info('Starting BowlNow-sync retry sweep', {
    intervalMs,
    maxAttempts: BN_SYNC_MAX_ATTEMPTS,
  });

  const tick = async () => {
    if (sweepInFlight) return;
    sweepInFlight = true;
    try {
      const summary = await runBowlnowSyncRetrySweep();
      if (summary.scanned > 0 || summary.retried > 0) {
        log.info('BowlNow-sync retry sweep tick', summary);
      }
    } catch (err) {
      log.error('BowlNow-sync retry sweep tick failed', {
        error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
      });
    } finally {
      sweepInFlight = false;
    }
  };

  sweepInterval = setInterval(() => { void tick(); }, intervalMs);
  if (sweepInterval && typeof sweepInterval === 'object' && 'unref' in sweepInterval) {
    sweepInterval.unref();
  }

  // Fire one tick immediately so a server that came up after a long
  // outage starts retrying without waiting a full interval.
  void tick();
}

export function stopBowlnowSyncRetrySweep(): void {
  if (sweepInterval !== null) {
    clearInterval(sweepInterval);
    sweepInterval = null;
    log.info('BowlNow-sync retry sweep stopped');
  }
}
