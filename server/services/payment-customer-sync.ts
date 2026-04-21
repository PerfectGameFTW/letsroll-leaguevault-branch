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

const log = createLogger('PaymentCustomerSync');

export type PaymentSyncStatus = 'synced' | 'skipped' | 'pending_retry' | 'not_applicable';

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

  const bowlerUpdate: Record<string, any> = {};
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
  try {
    const userProvider = await getPaymentProvider(resolvedSquareLocationId);
    providerCustomer = await userProvider.createOrUpdateCustomer(
      user.name,
      user.email,
      user.phone,
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
    try {
      await storage.updateBowler(bowler.id, {
        ...bowler,
        ...bowlerUpdate,
        paymentSyncPendingAt: new Date().toISOString(),
      });
    } catch (markErr) {
      log.error('Failed to flag bowler for payment-sync retry:', markErr);
    }
    return 'pending_retry';
  }

  const updates: Record<string, any> = { ...bowlerUpdate };
  let needsWrite = false;
  if (providerCustomer && providerCustomer.id !== bowler.paymentCustomerId) {
    updates.paymentCustomerId = providerCustomer.id;
    needsWrite = true;
    log.info('Linked payment customer to bowler:', providerCustomer.id);
  }
  if (bowler.paymentSyncPendingAt !== null) {
    updates.paymentSyncPendingAt = null;
    needsWrite = true;
  }
  if (needsWrite) {
    try {
      await storage.updateBowler(bowler.id, { ...bowler, ...updates });
    } catch (e) {
      log.error('Failed to persist post-sync bowler updates:', e);
      return 'pending_retry';
    }
  }
  return 'synced';
}
