import type { Bowler } from "@shared/schema";
import type { PaymentProvider } from "./payment-provider";
import { storage } from "../storage";
import { createLogger } from "../logger";

const log = createLogger('PaymentUtils');

export function getProviderCustomerId(bowler: Bowler, provider: PaymentProvider): string | undefined {
  if (provider.providerName === 'clover') {
    return bowler.cloverCustomerId || undefined;
  }
  return bowler.paymentCustomerId || undefined;
}

/**
 * Persist the Clover customer id (and the originating processor
 * location) on the bowler row after a successful save-card-on-file
 * round-trip. The Clover save-card flow takes a customer id as input
 * and returns a saved-source id — not the customer id itself — so the
 * customer id is sourced from the caller-supplied `customerId` rather
 * than the saved-card id. No-op for non-Clover providers.
 *
 * Stamping `paymentProviderLocationId` here lets the account-deletion
 * service target exactly one processor for cleanup later instead of
 * scanning every league-reachable location (see task #346).
 */
export async function persistCloverCustomer(
  provider: PaymentProvider,
  customerId: string | undefined,
  bowlerId: number,
): Promise<void> {
  if (provider.providerName !== 'clover') return;
  if (!customerId) return;
  try {
    await storage.updateBowler(bowlerId, {
      cloverCustomerId: customerId,
      paymentProviderLocationId: provider.locationId,
    });
  } catch (profileError) {
    log.error('Failed to persist Clover customer ID on bowler:', profileError);
  }
}
