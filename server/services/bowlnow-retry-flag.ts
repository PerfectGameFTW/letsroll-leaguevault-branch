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
