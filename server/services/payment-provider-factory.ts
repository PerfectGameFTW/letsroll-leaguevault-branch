import type { PaymentProvider } from './payment-provider';
import { SquarePaymentProvider } from './square-provider';
import { CardPointePaymentProvider } from './cardpointe-provider';
import { storage } from '../storage';
import { createLogger } from '../logger';

const log = createLogger('PaymentProviderFactory');

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  provider: PaymentProvider | null;
  expiresAt: number;
}

const providerCache = new Map<number, CacheEntry>();

export async function getPaymentProvider(locationId: number | null): Promise<PaymentProvider | null> {
  if (locationId == null) {
    log.warn('getPaymentProvider called without locationId — no provider available');
    return null;
  }

  const now = Date.now();
  const cached = providerCache.get(locationId);
  if (cached && cached.expiresAt > now) {
    return cached.provider;
  }

  const location = await storage.getLocation(locationId);
  if (!location) {
    log.warn(`Location ${locationId} not found`);
    providerCache.set(locationId, { provider: null, expiresAt: now + CACHE_TTL_MS });
    return null;
  }

  const providerType = location.paymentProvider ?? 'square';

  let provider: PaymentProvider | null;
  switch (providerType) {
    case 'square':
      provider = new SquarePaymentProvider(locationId);
      break;
    case 'cardpointe':
      provider = new CardPointePaymentProvider(locationId);
      break;
    default:
      log.error(`Unknown payment provider "${providerType}" for location ${locationId}`);
      provider = null;
      break;
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
