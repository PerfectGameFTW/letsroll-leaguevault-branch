import { useState, useEffect, useRef } from "react";
import type { PaymentProviderType } from "@shared/schema";

export interface PaymentProviderConfig {
  paymentProvider: PaymentProviderType;
  appId?: string;
  locationId?: string;
  tokenizerUrl?: string | null;
}

interface UsePaymentProviderReturn {
  config: PaymentProviderConfig | null;
  isLoading: boolean;
  error: string | null;
  isSquare: boolean;
  isCardPointe: boolean;
  supportsWallets: boolean;
}

const configCache = new Map<string, PaymentProviderConfig>();

export function usePaymentProvider(locationId?: number | null): UsePaymentProviderReturn {
  const [config, setConfig] = useState<PaymentProviderConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const cacheKey = String(locationId ?? 'default');
    const cached = configCache.get(cacheKey);
    if (cached) {
      setConfig(cached);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const url = locationId
      ? `/api/payments-provider/config?locationId=${locationId}`
      : '/api/payments-provider/config';

    fetch(url, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch payment config');
        const data = await res.json();
        const cfg: PaymentProviderConfig = {
          paymentProvider: data.paymentProvider || 'square',
          appId: data.appId,
          locationId: data.locationId,
          tokenizerUrl: data.tokenizerUrl,
        };
        configCache.set(cacheKey, cfg);
        if (mountedRef.current) {
          setConfig(cfg);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load payment config');
          setIsLoading(false);
        }
      });
  }, [locationId]);

  const provider = config?.paymentProvider ?? 'square';

  return {
    config,
    isLoading,
    error,
    isSquare: provider === 'square',
    isCardPointe: provider === 'cardpointe',
    supportsWallets: provider === 'square',
  };
}

export function clearProviderConfigCache() {
  configCache.clear();
}
