import type { Bowler } from "@shared/schema";
import type { PaymentProvider } from "./payment-provider";
import { storage } from "../storage";
import { createLogger } from "../logger";

const log = createLogger('PaymentUtils');

export function getProviderCustomerId(bowler: Bowler, provider: PaymentProvider): string | undefined {
  if (provider.providerName === 'cardpointe') {
    return bowler.cardpointeProfileId || undefined;
  }
  return bowler.paymentCustomerId || undefined;
}

export async function persistCardpointeProfile(provider: PaymentProvider, cardId: string, bowlerId: number): Promise<void> {
  if (provider.providerName === 'cardpointe' && cardId.includes('/')) {
    const profileId = cardId.split('/')[0];
    try {
      // Stamp the originating location alongside the profile so the
      // account-deletion service can target exactly one processor
      // for cleanup later instead of scanning every league-reachable
      // location. See task #346.
      await storage.updateBowler(bowlerId, {
        cardpointeProfileId: profileId,
        paymentProviderLocationId: provider.locationId,
      });
    } catch (profileError) {
      log.error('Failed to persist CardPointe profile ID on bowler:', profileError);
    }
  }
}
