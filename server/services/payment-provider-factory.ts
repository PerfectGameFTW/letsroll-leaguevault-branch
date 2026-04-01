import type { PaymentProvider } from './payment-provider';
import { SquarePaymentProvider } from './square-provider';
import { CardPointePaymentProvider } from './cardpointe-provider';
import { storage } from '../storage';
import { createLogger } from '../logger';

const log = createLogger('PaymentProviderFactory');

export class ProviderNotConfiguredError extends Error {
  public readonly code = 'PROVIDER_NOT_CONFIGURED';

  constructor(reason: string, public readonly locationId: number | null) {
    super(reason);
    this.name = 'ProviderNotConfiguredError';
  }
}

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  provider: PaymentProvider;
  expiresAt: number;
}

const providerCache = new Map<number, CacheEntry>();

export async function getPaymentProvider(locationId: number | null): Promise<PaymentProvider> {
  if (locationId == null) {
    throw new ProviderNotConfiguredError(
      'No location ID provided — payment provider cannot be resolved',
      locationId,
    );
  }

  const now = Date.now();
  const cached = providerCache.get(locationId);
  if (cached && cached.expiresAt > now) {
    return cached.provider;
  }

  const location = await storage.getLocation(locationId);
  if (!location) {
    throw new ProviderNotConfiguredError(
      `Location ${locationId} not found`,
      locationId,
    );
  }

  const providerType = location.paymentProvider ?? 'square';

  let provider: PaymentProvider;
  switch (providerType) {
    case 'square':
      provider = new SquarePaymentProvider(locationId);
      break;
    case 'cardpointe':
      provider = new CardPointePaymentProvider(locationId);
      break;
    default:
      throw new ProviderNotConfiguredError(
        `Unknown payment provider "${providerType}" for location ${locationId}`,
        locationId,
      );
  }

  providerCache.set(locationId, { provider, expiresAt: now + CACHE_TTL_MS });
  return provider;
}

export function clearProviderCache(locationId?: number): void {
  if (locationId !== undefined) {
    providerCache.delete(locationId);
    log.info(`Cleared payment provider cache for location ${locationId}`);
  } else {
    providerCache.clear();
    log.info('Cleared entire payment provider cache');
  }
}
