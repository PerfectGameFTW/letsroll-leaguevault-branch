import { storage } from '../storage';
import { getPaymentProvider, ProviderNotConfiguredError } from './payment-provider-factory';
import { syncBowlerToBN, isOrgBNConfigured } from './bowlnow.js';
import { flagBowlerForBnRetry, clearBowlerBnRetry } from './bowlnow-retry-flag.js';
import { createLogger } from '../logger';
import { isDev } from '../config';
import type { Bowler } from '@shared/schema';
import type { PaymentProvider } from './payment-provider';
import { syncBowlerLeagueAttributesToProvider } from './bowler-attributes';
import { decideBowlerPhoneSync } from './bowler-phone-sync';

const log = createLogger("BowlerSync");

export async function runBowlerPostCreateSync(
  bowler: Bowler,
  organizationId: number | undefined,
): Promise<Bowler> {
  let current = bowler;

  const bowlerEmail = current.email;
  // Track whether the post-create Square sync ended up with a linked
  // customer id. Every code path that today silently leaves the
  // bowler without a `paymentCustomerId` (no Square location
  // configured for the org, ProviderNotConfiguredError, generic
  // provider throw, provider returned no customer id) must now stamp
  // `paymentSyncPendingAt` so the background retry sweep
  // (`server/services/payment-sync-retry.ts`) picks the bowler up
  // and re-runs the customer sync. The `bowlerEmail` guard below is
  // intentionally kept — a bowler with no email genuinely has
  // nothing to sync, mirroring `syncBowlerForUser`'s `'skipped'`
  // contract. Task #682.
  let squareCustomerLinked = false;
  if (bowlerEmail) {
    try {
      const matchingUser = await storage.getUserByEmail(bowlerEmail);
      if (matchingUser && !matchingUser.bowlerId) {
        await storage.linkUserToBowler(matchingUser.id, current.id);
        log.info(`Auto-linked user ${matchingUser.id} to bowler ${current.id}`);

        // Task #677: user wins for `phone`. Apply the overwrite
        // BEFORE the Square / BowlNow branches below so the
        // downstream `createOrUpdateCustomer` and `syncBowlerToBN`
        // both see the right value (they read off `current.phone`
        // / `bowler.phone` respectively).
        const phoneDecision = decideBowlerPhoneSync(matchingUser, current);
        if (phoneDecision.write) {
          try {
            current = await storage.updateBowler(current.id, { phone: phoneDecision.phone });
          } catch (phoneErr) {
            log.error('Bowler sync: failed to overwrite bowler.phone from linked user:', phoneErr);
          }
        }

        const bowlerLeagues = await storage.getBowlerLeagues({ bowlerId: current.id });
        if (bowlerLeagues.length > 0) {
          const league = await storage.getLeague(bowlerLeagues[0].leagueId);
          if (league?.organizationId && !matchingUser.organizationId) {
            await storage.setUserOrganization(matchingUser.id, league.organizationId);
            if (isDev) log.info(`Set user ${matchingUser.id} organization to ${league.organizationId}`);
          }
        }
      }
    } catch (linkError) {
      log.error('Error auto-linking user to bowler:', linkError);
    }

    try {
      const squareLocation = organizationId
        ? await storage.getFirstSquareConfiguredLocation(organizationId)
        : null;
      if (squareLocation?.id) {
        let providerCustomer = null;
        // Lifted out of the inner `try` so the post-customer attribute
        // sync (task #429) can reuse the same provider instance —
        // re-resolving here would either bill us for an extra Square
        // round trip or, worse, race against a credential rotation.
        let syncProvider: PaymentProvider | null = null;
        try {
          syncProvider = await getPaymentProvider(squareLocation.id);
          providerCustomer = await syncProvider.createOrUpdateCustomer(
            current.name,
            bowlerEmail,
            current.phone,
            // Bowler reference for the Square dashboard (task #429).
            `bowler:${current.id}`,
          );
        } catch (e) {
          if (e instanceof ProviderNotConfiguredError) {
            log.warn('Bowler sync: provider not configured, skipping customer sync', { locationId: squareLocation.id });
          } else {
            throw e;
          }
        }
        if (providerCustomer) {
          squareCustomerLinked = true;
          current = await storage.updateBowler(current.id, {
            ...current,
            paymentCustomerId: providerCustomer.id,
            // Stamp the originating location so account-deletion can
            // target exactly this processor for cleanup. See task #346.
            paymentProviderLocationId: squareLocation.id,
            active: true,
          });

          // Push the bowler's current league_name + league_season to
          // Square. NON-FATAL by contract: if the writes fail we flag
          // the bowler so `payment-sync-retry.ts` re-runs the whole
          // customer sync (which loops back through this helper) on
          // the next sweep. We never throw or roll back the customer
          // record over an attribute failure (task #429).
          if (syncProvider) {
            const attrResult = await syncBowlerLeagueAttributesToProvider(
              syncProvider,
              providerCustomer.id,
              current.id,
            );
            if (!attrResult.ok && current.paymentSyncPendingAt == null) {
              try {
                current = await storage.updateBowler(current.id, {
                  ...current,
                  paymentSyncPendingAt: new Date().toISOString(),
                });
              } catch (markErr) {
                log.error(
                  'Bowler sync: failed to flag bowler for attribute-sync retry',
                  markErr,
                );
              }
            }
          }
        }
      }
    } catch (syncError) {
      log.error('Payment provider error during bowler sync:', syncError);
    }

    // Task #682: if every code path above failed to link a Square
    // customer (no Square location configured for the org,
    // ProviderNotConfiguredError, generic provider throw, or provider
    // returned no customer id), flag the bowler so the background
    // retry sweep picks it up and re-runs the customer sync. Without
    // this flag the bowler stays in `paymentCustomerId IS NULL`
    // limbo forever — the sweep only walks rows whose
    // `paymentSyncPendingAt` is set, and no other code path was
    // restamping it after the silent failure.
    //
    // Leave `paymentSyncAttempts` at 0 so the first sweep tick
    // retries promptly (the backoff math anchors on the most recent
    // attempt; with attempts=0 the backoff is the base 60s).
    if (!squareCustomerLinked && current.paymentSyncPendingAt == null) {
      try {
        current = await storage.updateBowler(current.id, {
          ...current,
          paymentSyncPendingAt: new Date().toISOString(),
        });
      } catch (markErr) {
        log.error(
          'Bowler sync: failed to flag bowler for post-create retry',
          markErr,
        );
      }
    }
  }

  if (organizationId) {
    try {
      const orgConfig = await storage.getOrgIntegrations(organizationId);
      if (isOrgBNConfigured(orgConfig)) {
        // Inspect the resolved value too — `syncBowlerToBN` returns
        // `{success:false}` for most BN failures rather than throwing,
        // so the prior `.catch()`-only handler dropped them silently
        // (task #480 architect review).
        void syncBowlerToBN(current.id, orgConfig)
          .then(async (result) => {
            if (!result.success) {
              log.warn('BowlNow sync returned failure during bowler sync', {
                bowlerId: current.id,
                error: result.error,
              });
              await flagBowlerForBnRetry(current.id);
            } else {
              // Clear any prior pending/attempt state on success so a
              // row that hit max attempts earlier isn't stuck forever
              // (architect review on #480).
              await clearBowlerBnRetry(current.id);
            }
          })
          .catch(async (e) => {
            log.error('BowlNow sync error:', e);
            await flagBowlerForBnRetry(current.id);
          });
      }
    } catch (bnError) {
      log.error('BowlNow config error during bowler sync:', bnError);
    }
  }

  return current;
}
