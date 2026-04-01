import type { Bowler } from "@shared/schema";
import type { PaymentProvider } from "./payment-provider";

export function getProviderCustomerId(bowler: Bowler, provider: PaymentProvider): string | undefined {
  if (provider.providerName === 'cardpointe') {
    return bowler.cardpointeProfileId || undefined;
  }
  return bowler.paymentCustomerId || undefined;
}
