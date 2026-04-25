import { storage } from '../storage';
import { getPaymentProvider, ProviderNotConfiguredError } from './payment-provider-factory';
import { syncBowlerToBN, isOrgBNConfigured } from './bowlnow.js';
import { createLogger } from '../logger';
import { isDev } from '../config';
import type { Bowler } from '@shared/schema';
import type { PaymentProvider } from './payment-provider';
import { syncBowlerLeagueAttributesToProvider } from './bowler-attributes';

const log = createLogger("BowlerSync");

export async function runBowlerPostCreateSync(
  bowler: Bowler,
  organizationId: number | undefined,
): Promise<Bowler> {
  let current = bowler;

  if (current.email) {
    try {
      const matchingUser = await storage.getUserByEmail(current.email);
      if (matchingUser && !matchingUser.bowlerId) {
        await storage.linkUserToBowler(matchingUser.id, current.id);
        log.info(`Auto-linked user ${matchingUser.id} to bowler ${current.id}`);
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
            current.email,
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
  }

  if (organizationId) {
    try {
      const orgConfig = await storage.getOrgIntegrations(organizationId);
      if (isOrgBNConfigured(orgConfig)) {
        syncBowlerToBN(current.id, orgConfig).catch((e) =>
          log.error('BowlNow sync error:', e),
        );
      }
    } catch (bnError) {
      log.error('BowlNow config error during bowler sync:', bnError);
    }
  }

  return current;
}
