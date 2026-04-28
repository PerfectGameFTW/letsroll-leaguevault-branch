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

/**
 * Guarantee that the bowler has a provider customer id before a
 * save-card / list-cards / remove-card round-trip. For Square this is
 * normally bootstrapped by the profile-update sync (see
 * `payment-customer-sync.ts`), but Clover orgs don't run through that
 * Square-only path, so a first-time Clover bowler would otherwise hit
 * "no payment customer account" 400s on save-card. This helper performs
 * a just-in-time `createOrUpdateCustomer` against the active provider
 * and persists the resulting id on the bowler row so subsequent calls
 * (list, charge, delete) pick it up via `getProviderCustomerId`.
 *
 * Returns the resolved customer id, or `undefined` if the bowler has
 * no email (Clover requires email) or the provider call failed.
 */
export async function ensureProviderCustomer(
  provider: PaymentProvider,
  bowler: Bowler,
): Promise<string | undefined> {
  const existing = getProviderCustomerId(bowler, provider);
  if (existing) return existing;
  if (!bowler.email) return undefined;
  try {
    const customer = await provider.createOrUpdateCustomer(
      bowler.name,
      bowler.email,
      bowler.phone ?? null,
      `bowler:${bowler.id}`,
    );
    if (!customer?.id) return undefined;
    if (provider.providerName === 'clover') {
      await persistCloverCustomer(provider, customer.id, bowler.id);
    } else {
      try {
        await storage.updateBowler(bowler.id, {
          paymentCustomerId: customer.id,
          paymentProviderLocationId: provider.locationId,
        });
      } catch (writeErr) {
        log.error('Failed to persist provider customer ID on bowler:', writeErr);
      }
    }
    return customer.id;
  } catch (err) {
    log.warn('ensureProviderCustomer: createOrUpdateCustomer failed', {
      bowlerId: bowler.id,
      providerName: provider.providerName,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
