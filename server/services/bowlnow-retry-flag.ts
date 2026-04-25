/**
 * Shared helper for queueing a bowler into the BowlNow-sync retry sweep
 * (task #480). Every call site that fires `syncBowlerToBN` and inspects
 * its `{success, error}` result must call this on the failure branch
 * (and on a thrown error) so the background sweep at
 * `server/services/bowlnow-sync-retry.ts` can re-attempt the contact
 * push later. Without this, a transient BowlNow 5xx during a profile
 * update / org sync / league mutation silently leaves the bowler's
 * BowlNow contact stale until the next manual sync-all.
 *
 * No-op when the flag is already set so a tight burst of failures
 * (e.g., 200 bowlers in a renamed league all hitting a BN outage)
 * doesn't keep re-stamping the timestamp and resetting the backoff
 * window. The sweep itself owns the lease-stamp on
 * `bn_sync_last_attempt_at` and the attempt counter.
 */
import { storage } from '../storage';
import { createLogger } from '../logger';

const log = createLogger('BowlnowRetryFlag');

export async function flagBowlerForBnRetry(bowlerId: number): Promise<void> {
  try {
    const fresh = await storage.getBowler(bowlerId);
    if (!fresh || fresh.bnSyncPendingAt != null) return;
    await storage.updateBowler(bowlerId, {
      ...fresh,
      bnSyncPendingAt: new Date().toISOString(),
    });
  } catch (markErr) {
    log.error('Failed to flag bowler for BN retry', {
      bowlerId,
      error: markErr instanceof Error ? { name: markErr.name, message: markErr.message } : markErr,
    });
  }
}

/**
 * Inverse of `flagBowlerForBnRetry`: clears the BN retry state when a
 * foreground (non-sweep) BowlNow call succeeds. The sweep itself
 * already clears on success, but a row that previously hit
 * BN_SYNC_MAX_ATTEMPTS would otherwise stay flagged forever — even
 * after a later foreground edit/sync put the contact back in sync —
 * because the sweep's `bn_sync_attempts < cap` filter excludes it.
 * Added per architect review on #480.
 *
 * Also resets `bn_sync_attempts` and `bn_sync_last_attempt_at` so the
 * next failure starts a fresh backoff window. No-op when the row is
 * already in a clean state to avoid pointless writes.
 */
export async function clearBowlerBnRetry(bowlerId: number): Promise<void> {
  try {
    const fresh = await storage.getBowler(bowlerId);
    if (!fresh) return;
    if (
      fresh.bnSyncPendingAt == null &&
      (fresh.bnSyncAttempts ?? 0) === 0 &&
      fresh.bnSyncLastAttemptAt == null
    ) {
      return;
    }
    await storage.updateBowler(bowlerId, {
      ...fresh,
      bnSyncPendingAt: null,
      bnSyncAttempts: 0,
      bnSyncLastAttemptAt: null,
    });
  } catch (clearErr) {
    log.error('Failed to clear bowler BN retry state', {
      bowlerId,
      error: clearErr instanceof Error ? { name: clearErr.name, message: clearErr.message } : clearErr,
    });
  }
}
