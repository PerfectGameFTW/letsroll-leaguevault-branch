import { useState, useEffect, useRef } from "react";
import type { PaymentProviderType } from "@shared/schema";

export interface PaymentProviderConfig {
  paymentProvider: PaymentProviderType;
  appId?: string;
  locationId?: string;
  merchantId?: string;
  publicTokenizerKey?: string;
  environment?: 'sandbox' | 'production';
}

interface UsePaymentProviderReturn {
  config: PaymentProviderConfig | null;
  isLoading: boolean;
  error: string | null;
  isSquare: boolean;
  isClover: boolean;
  supportsWallets: boolean;
}

interface CacheEntry {
  config: PaymentProviderConfig;
  timestamp: number;
}

const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;
const configCache = new Map<string, CacheEntry>();

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
    if (cached && (Date.now() - cached.timestamp) < CONFIG_CACHE_TTL_MS) {
      setConfig(cached.config);
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
          merchantId: data.merchantId,
          publicTokenizerKey: data.publicTokenizerKey,
          environment: data.environment,
        };
        configCache.set(cacheKey, { config: cfg, timestamp: Date.now() });
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
    isClover: provider === 'clover',
    supportsWallets: provider === 'square',
  };
}

export function clearProviderConfigCache() {
  configCache.clear();
}
