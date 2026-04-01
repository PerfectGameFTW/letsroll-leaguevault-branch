import type { PaymentProvider } from './payment-provider';
import { SquarePaymentProvider } from './square-provider';
import { storage } from '../storage';
import { createLogger } from '../logger';

const log = createLogger('PaymentProviderFactory');

export async function getPaymentProvider(locationId: number | null): Promise<PaymentProvider | null> {
  if (locationId == null) {
    log.warn('getPaymentProvider called without locationId — no provider available');
    return null;
  }

  const location = await storage.getLocation(locationId);
  if (!location) {
    log.warn(`Location ${locationId} not found`);
    return null;
  }

  const providerType = location.paymentProvider ?? 'square';

  switch (providerType) {
    case 'square':
      return new SquarePaymentProvider(locationId);
    case 'cardpointe':
      log.warn(`CardPointe provider not yet implemented for location ${locationId}`);
      return null;
    default:
      log.error(`Unknown payment provider "${providerType}" for location ${locationId}`);
      return null;
  }
}
