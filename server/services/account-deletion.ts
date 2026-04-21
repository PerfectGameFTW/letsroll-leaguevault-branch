import { storage } from '../storage';
import { db } from '../db.js';
import { bowlerLeagues, leagues, emailChangeRequests } from '@shared/schema';
import { eq, inArray } from 'drizzle-orm';
import { createLogger } from '../logger';
import {
  getPaymentProvider,
  ProviderNotConfiguredError,
} from './payment-provider-factory';
import { hasCustomerCleanupSupport } from './payment-provider';
import type { DeletionExecutionSummary } from '@shared/schema';

const log = createLogger('AccountDeletion');

interface ProviderTarget {
  locationId: number;
  customerId: string;
}

/**
 * Collect every distinct (locationId, paymentCustomerId) pair we should
 * try to delete on the payment processor side for this set of bowlers.
 * The bowler's customer record was created at one specific provider, but
 * we don't store which one — we attempt every location reachable through
 * the bowler's leagues so the cleanup is best-effort but exhaustive.
 */
async function collectProviderTargets(
  bowlers: { id: number; paymentCustomerId: string | null; cardpointeProfileId: string | null }[],
): Promise<ProviderTarget[]> {
  const customerByBowler = new Map<number, string[]>();
  for (const b of bowlers) {
    const ids: string[] = [];
    if (b.paymentCustomerId) ids.push(b.paymentCustomerId);
    if (b.cardpointeProfileId && b.cardpointeProfileId !== b.paymentCustomerId) {
      ids.push(b.cardpointeProfileId);
    }
    if (ids.length > 0) customerByBowler.set(b.id, ids);
  }
  if (customerByBowler.size === 0) return [];

  const bowlerIds = Array.from(customerByBowler.keys());
  const rows = await db
    .selectDistinct({ bowlerId: bowlerLeagues.bowlerId, locationId: leagues.locationId })
    .from(bowlerLeagues)
    .innerJoin(leagues, eq(bowlerLeagues.leagueId, leagues.id))
    .where(inArray(bowlerLeagues.bowlerId, bowlerIds));

  const targets: ProviderTarget[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.locationId == null) continue;
    const ids = customerByBowler.get(r.bowlerId) ?? [];
    for (const cid of ids) {
      const key = `${r.locationId}:${cid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ locationId: r.locationId, customerId: cid });
    }
  }
  return targets;
}

/**
 * Execute the automated account-data deletion for a single email
 * address. Anonymizes every matching bowler row (preserving FK-protected
 * historical data), best-effort deletes the corresponding customer
 * records on each configured payment provider, removes any pending
 * email-change requests for the user account, and finally deletes the
 * user row.
 *
 * Returns a structured audit summary describing what was removed. The
 * caller is expected to persist this onto the originating deletion
 * request (see `completeDeletionRequestWithExecution`).
 */
export async function executeAccountDeletion(
  email: string,
  reviewerId: number,
): Promise<DeletionExecutionSummary> {
  const summary: DeletionExecutionSummary = {
    executedAt: new Date().toISOString(),
    executedBy: reviewerId,
    email,
    user: { deleted: false, userId: null },
    bowlers: [],
    paymentProvider: [],
    emailChangeRequestsDeleted: 0,
  };

  const bowlersToScrub = await storage.getBowlersByEmailSystemAdmin(email);

  // Collect provider cleanup targets BEFORE we anonymize, since the
  // anonymize step nulls paymentCustomerId/cardpointeProfileId.
  const providerTargets = await collectProviderTargets(bowlersToScrub);

  // 1. Best-effort delete customer records at the payment processors.
  for (const target of providerTargets) {
    let providerName = 'unknown';
    try {
      const provider = await getPaymentProvider(target.locationId);
      providerName = provider.providerName;
      if (!hasCustomerCleanupSupport(provider)) {
        summary.paymentProvider.push({
          locationId: target.locationId,
          providerName,
          customerId: target.customerId,
          deleted: false,
          error: 'provider does not support customer deletion',
        });
        continue;
      }
      await provider.deleteCustomer(target.customerId);
      summary.paymentProvider.push({
        locationId: target.locationId,
        providerName,
        customerId: target.customerId,
        deleted: true,
      });
    } catch (error) {
      const msg =
        error instanceof ProviderNotConfiguredError
          ? error.message
          : error instanceof Error
          ? error.message
          : String(error);
      log.warn('Payment-provider customer deletion failed', {
        locationId: target.locationId,
        customerId: target.customerId,
        error: msg,
      });
      summary.paymentProvider.push({
        locationId: target.locationId,
        providerName,
        customerId: target.customerId,
        deleted: false,
        error: msg,
      });
    }
  }

  // 2. Anonymize each bowler row in place. We deliberately do NOT
  //    cascade-delete bowlers here because that would wipe payments,
  //    scores, and historical league data via the ON DELETE CASCADE
  //    foreign keys. Anonymization preserves history while removing
  //    PII.
  for (const bowler of bowlersToScrub) {
    const entry = {
      bowlerId: bowler.id,
      anonymized: false,
      hadPaymentCustomerId: !!bowler.paymentCustomerId,
      hadCardpointeProfileId: !!bowler.cardpointeProfileId,
    } as DeletionExecutionSummary['bowlers'][number];
    try {
      await storage.anonymizeBowler(bowler.id);
      entry.anonymized = true;
    } catch (error) {
      entry.reason = error instanceof Error ? error.message : String(error);
      log.error('Failed to anonymize bowler', { bowlerId: bowler.id, error: entry.reason });
    }
    summary.bowlers.push(entry);
  }

  // 3. Find the user row by email (case-insensitive lookup since the
  //    schema stores them as-supplied; getUserByEmail uses exact match
  //    so we try a normalised variant too).
  const user =
    (await storage.getUserByEmail(email)) ??
    (await storage.getUserByEmail(email.toLowerCase()));

  if (user) {
    summary.user.userId = user.id;

    // Delete pending email-change requests up front. They have ON
    // DELETE CASCADE, so this is mostly belt-and-suspenders, but we
    // also want a count for the audit log.
    const ecrRows = await db
      .delete(emailChangeRequests)
      .where(eq(emailChangeRequests.userId, user.id))
      .returning({ id: emailChangeRequests.id });
    summary.emailChangeRequestsDeleted = ecrRows.length;

    try {
      await storage.deleteUser(user.id);
      summary.user.deleted = true;
    } catch (error) {
      summary.user.reason = error instanceof Error ? error.message : String(error);
      log.error('Failed to delete user during automated deletion', {
        userId: user.id,
        error: summary.user.reason,
      });
    }
  } else {
    summary.user.reason = 'no user account found for this email';
  }

  log.info('Executed automated account deletion', {
    email,
    reviewerId,
    bowlersAnonymized: summary.bowlers.filter((b) => b.anonymized).length,
    providerDeletions: summary.paymentProvider.filter((p) => p.deleted).length,
    userDeleted: summary.user.deleted,
  });

  return summary;
}
