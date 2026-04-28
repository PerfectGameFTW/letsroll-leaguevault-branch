import { useState, useEffect, useRef } from "react";
import type {
  PaymentProviderType,
  RequiredCloverField,
  RequiredSquareField,
} from "@shared/schema";

/**
 * Required-field name returned in `missingFields` from
 * `/api/payments-provider/config`. Either a Clover-specific or
 * Square-specific field name depending on the active provider for
 * the queried location. (Tasks #575, #579.)
 */
export type RequiredProviderField = RequiredCloverField | RequiredSquareField;

export interface PaymentProviderConfig {
  paymentProvider: PaymentProviderType;
  appId?: string;
  locationId?: string;
  merchantId?: string;
  publicTokenizerKey?: string;
  environment?: 'sandbox' | 'production';
  /** True when the active provider has every required credential set. */
  providerConfigured?: boolean;
  /** Names of required fields the active provider is still missing. */
  missingFields?: RequiredProviderField[];
}

interface UsePaymentProviderReturn {
  config: PaymentProviderConfig | null;
  isLoading: boolean;
  error: string | null;
  isSquare: boolean;
  isClover: boolean;
  supportsWallets: boolean;
  /**
   * True when the active provider for the location is fully configured
   * (e.g. all four required Clover credentials, or all three required
   * Square credentials, are present). Defaults to true while the config
   * is loading or when no `providerConfigured` flag is present in the
   * response (legacy/env-only Square config).
   */
  isProviderConfigured: boolean;
  /** Required fields the active provider is missing. */
  missingFields: RequiredProviderField[];
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
          providerConfigured: data.providerConfigured,
          missingFields: Array.isArray(data.missingFields) ? data.missingFields : undefined,
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
  // Default to "configured" while loading or when the server didn't
  // include the new flag (legacy/env-only Square responses) so we
  // don't flash an erroneous "not configured" banner before the
  // response arrives.
  const isProviderConfigured = config?.providerConfigured !== false;
  const missingFields = config?.missingFields ?? [];

  return {
    config,
    isLoading,
    error,
    isSquare: provider === 'square',
    isClover: provider === 'clover',
    supportsWallets: provider === 'square',
    isProviderConfigured,
    missingFields,
  };
}

export function clearProviderConfigCache() {
  configCache.clear();
}
