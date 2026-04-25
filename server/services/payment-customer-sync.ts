/**
 * Payment-customer sync helper used by profile updates and the admin
 * "retry payment sync" endpoint.
 *
 * Returns a status the API caller can use to surface a "your payment
 * record may be stale, we'll retry" notice when the provider call fails
 * for a real reason. Real failures also flip
 * `bowlers.payment_sync_pending_at` so the admin retry endpoint and the
 * next profile edit can re-attempt without losing track of the work.
 */
import { storage } from '../storage';
import { getPaymentProvider, ProviderNotConfiguredError } from './payment-provider-factory';
import { createLogger } from '../logger';
import { isDev } from '../config';
import type { PaymentProvider } from './payment-provider';
import { syncBowlerLeagueAttributesToProvider } from './bowler-attributes';
import { syncBowlerToBN, isOrgBNConfigured } from './bowlnow.js';
import { flagBowlerForBnRetry, clearBowlerBnRetry } from './bowlnow-retry-flag.js';

const log = createLogger('PaymentCustomerSync');

export type PaymentSyncStatus = 'synced' | 'skipped' | 'pending_retry' | 'not_applicable';

// Background retry sweep gives up after this many consecutive failed
// attempts (task #284). Surfaced here so the sweep service and the
// helper agree on when to log the structured "given up" error.
export const PAYMENT_SYNC_MAX_ATTEMPTS = 5;

export interface SyncableUser {
  id: number;
  bowlerId: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  locationId: number | null;
  organizationId: number | null;
}

export interface ProfileChanges {
  nameChanged: boolean;
  emailChanged: boolean;
  phoneChanged: boolean;
}

export async function syncBowlerForUser(
  user: SyncableUser,
  changed: ProfileChanges,
): Promise<PaymentSyncStatus> {
  if (!user.bowlerId) return 'not_applicable';

  const bowler = await storage.getBowler(user.bowlerId);
  if (!bowler) return 'not_applicable';

  const bowlerUpdate: Record<string, unknown> = {};
  if (changed.nameChanged) bowlerUpdate.name = user.name;
  if (changed.emailChanged) bowlerUpdate.email = user.email;
  if (changed.phoneChanged) bowlerUpdate.phone = user.phone;

  if (Object.keys(bowlerUpdate).length > 0) {
    try {
      await storage.updateBowler(bowler.id, { ...bowler, ...bowlerUpdate });
      if (isDev) log.info('Synced profile changes to bowler record:', bowler.id);
    } catch (e) {
      log.error('Failed to write local bowler row during profile sync:', e);
      return 'pending_retry';
    }
  }

  if (!user.email) return 'skipped';

  let resolvedSquareLocationId: number | null = null;
  if (user.locationId) {
    const locationCreds = await storage.getLocationSquareConfig(user.locationId);
    if ((locationCreds?.accessToken ?? '').trim().length > 0) {
      resolvedSquareLocationId = user.locationId;
    }
  }
  if (!resolvedSquareLocationId && user.organizationId) {
    const sq = await storage.getFirstSquareConfiguredLocation(user.organizationId);
    resolvedSquareLocationId = sq?.id ?? null;
  }
  if (!resolvedSquareLocationId) {
    if (isDev) log.info('No payment-configured location found, skipping customer sync');
    return 'skipped';
  }

  let providerCustomer: { id: string } | null = null;
  // Lifted so the post-customer attribute sync (task #429) can reuse
  // the same provider instance.
  let userProvider: PaymentProvider | null = null;
  try {
    userProvider = await getPaymentProvider(resolvedSquareLocationId);
    providerCustomer = await userProvider.createOrUpdateCustomer(
      user.name,
      user.email,
      user.phone,
      // Bowler reference for the Square dashboard (task #429).
      `bowler:${bowler.id}`,
    );
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) {
      log.warn('User update: provider not configured, skipping customer sync', { locationId: resolvedSquareLocationId });
      return 'skipped';
    }
    log.warn('Payment customer sync failed, marking bowler for retry', {
      userId: user.id,
      bowlerId: bowler.id,
      locationId: resolvedSquareLocationId,
      errorName: e instanceof Error ? e.name : 'unknown',
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    const nowIso = new Date().toISOString();
    const nextAttempts = (bowler.paymentSyncAttempts ?? 0) + 1;
    try {
      await storage.updateBowler(bowler.id, {
        ...bowler,
        ...bowlerUpdate,
        // Preserve the original failure timestamp so admins can see how
        // long this bowler has been pending; only set it the first time.
        paymentSyncPendingAt: bowler.paymentSyncPendingAt ?? nowIso,
        paymentSyncAttempts: nextAttempts,
        paymentSyncLastAttemptAt: nowIso,
      });
    } catch (markErr) {
      log.error('Failed to flag bowler for payment-sync retry:', markErr);
    }
    if (nextAttempts >= PAYMENT_SYNC_MAX_ATTEMPTS) {
      log.error('Payment-customer sync gave up after max retry attempts', {
        userId: user.id,
        bowlerId: bowler.id,
        locationId: resolvedSquareLocationId,
        attempts: nextAttempts,
        maxAttempts: PAYMENT_SYNC_MAX_ATTEMPTS,
        pendingSince: bowler.paymentSyncPendingAt ?? nowIso,
        errorName: e instanceof Error ? e.name : 'unknown',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
    return 'pending_retry';
  }

  // Custom-attribute sync (task #429). Run BEFORE we clear the pending
  // flag below so a failure here keeps the bowler in the retry queue
  // for the next sweep. Non-fatal by contract — the customer record is
  // still considered successfully synced even if attribute writes fail.
  let attrSyncOk = true;
  if (providerCustomer && userProvider) {
    const attrResult = await syncBowlerLeagueAttributesToProvider(
      userProvider,
      providerCustomer.id,
      bowler.id,
    );
    attrSyncOk = attrResult.ok;
  }

  // BowlNow parity (architect review on #429): the retry sweep
  // re-runs this helper to recover failed Square attribute writes;
  // when it does, also re-fire the BowlNow sync so the same
  // membership state lands on both platforms. Non-fatal — a BowlNow
  // failure here does NOT mark the bowler pending again (Square
  // remains the source of truth for the pending flag) but it is
  // logged for ops visibility. Use `bowler.organizationId` rather
  // than `user.organizationId` because for cross-org system_admin
  // edits the user's org may differ from the bowler's owning org.
  const bnOrgId = bowler.organizationId ?? user.organizationId ?? null;
  if (bnOrgId) {
    try {
      const orgConfig = await storage.getOrgIntegrations(bnOrgId);
      if (isOrgBNConfigured(orgConfig)) {
        // Inspect the result: `syncBowlerToBN` returns `{success:false}`
        // for most BN failures rather than throwing. Without this flag,
        // a transient BN 5xx during a profile-update / email-confirm
        // flow would silently leave the bowler's BN contact stale until
        // the next manual sync-all (architect feedback on #480).
        const bnResult = await syncBowlerToBN(bowler.id, orgConfig);
        if (!bnResult.success) {
          log.warn('BowlNow re-sync returned failure during payment-customer sync', {
            bowlerId: bowler.id,
            organizationId: bnOrgId,
            error: bnResult.error,
          });
          await flagBowlerForBnRetry(bowler.id);
        } else {
          // Symmetry with the sweep: a successful foreground BN sync
          // also clears any prior pending/attempt state so a row that
          // hit BN_SYNC_MAX_ATTEMPTS earlier doesn't stay stuck
          // (architect review on #480).
          await clearBowlerBnRetry(bowler.id);
        }
      }
    } catch (bnErr) {
      log.warn('BowlNow re-sync threw during payment-customer sync', {
        bowlerId: bowler.id,
        organizationId: bnOrgId,
        errorName: bnErr instanceof Error ? bnErr.name : 'unknown',
        errorMessage: bnErr instanceof Error ? bnErr.message : String(bnErr),
      });
      await flagBowlerForBnRetry(bowler.id);
    }
  }

  const updates: Record<string, unknown> = { ...bowlerUpdate };
  let needsWrite = false;
  if (providerCustomer && providerCustomer.id !== bowler.paymentCustomerId) {
    updates.paymentCustomerId = providerCustomer.id;
    // Stamp the originating location so account-deletion can target
    // exactly this processor for saved-card cleanup. See task #346.
    updates.paymentProviderLocationId = resolvedSquareLocationId;
    needsWrite = true;
    log.info('Linked payment customer to bowler:', providerCustomer.id);
  }
  if (attrSyncOk) {
    if (bowler.paymentSyncPendingAt !== null) {
      updates.paymentSyncPendingAt = null;
      needsWrite = true;
    }
    if ((bowler.paymentSyncAttempts ?? 0) > 0) {
      updates.paymentSyncAttempts = 0;
      needsWrite = true;
    }
    if (bowler.paymentSyncLastAttemptAt != null) {
      updates.paymentSyncLastAttemptAt = null;
      needsWrite = true;
    }
  } else {
    // Attribute writes failed: keep the bowler flagged so the retry
    // sweep (`payment-sync-retry.ts`) re-runs `syncBowlerForUser` and
    // ultimately re-runs the attribute upserts.
    const nowIso = new Date().toISOString();
    if (bowler.paymentSyncPendingAt == null) {
      updates.paymentSyncPendingAt = nowIso;
      needsWrite = true;
    }
  }
  if (needsWrite) {
    try {
      await storage.updateBowler(bowler.id, { ...bowler, ...updates });
    } catch (e) {
      log.error('Failed to persist post-sync bowler updates:', e);
      return 'pending_retry';
    }
  }
  return attrSyncOk ? 'synced' : 'pending_retry';
}
