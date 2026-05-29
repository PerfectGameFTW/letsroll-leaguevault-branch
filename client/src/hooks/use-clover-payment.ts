import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";

interface CloverTokenizeResult {
  token: string;
}

export interface CloverCard {
  tokenize(): Promise<CloverTokenizeResult>;
  destroy(): void;
  attach(container: HTMLElement): Promise<void>;
}

interface UseCloverPaymentOptions {
  publicTokenizerKey?: string | null;
  merchantId?: string | null;
  environment?: 'sandbox' | 'production' | null;
  onError?: (error: string) => void;
}

interface UseCloverPaymentReturn {
  card: CloverCard | null;
  isInitialized: boolean;
  error: string | null;
  initializeCard: (container: HTMLDivElement) => Promise<void>;
  cleanupCard: () => void;
}

interface CloverElement {
  mount(selector: string | HTMLElement): void;
  unmount(): void;
}

interface CloverElementsApi {
  create(type: string, opts?: Record<string, unknown>): CloverElement;
}

interface CloverInstance {
  elements(): CloverElementsApi;
  createToken(): Promise<{ token?: string; errors?: Record<string, unknown> }>;
}

interface CloverConstructor {
  new (publicKey: string, opts?: { merchantId?: string }): CloverInstance;
}

declare global {
  interface Window {
    Clover?: CloverConstructor;
  }
}

const CLOVER_SDK_URLS = {
  production: 'https://checkout.clover.com/sdk.js',
  sandbox: 'https://checkout.sandbox.dev.clover.com/sdk.js',
} as const;

const sdkLoadPromises = new Map<string, Promise<void>>();

function loadCloverSdk(environment: 'sandbox' | 'production'): Promise<void> {
  const url = CLOVER_SDK_URLS[environment];
  const cached = sdkLoadPromises.get(url);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Clover SDK can only load in a browser environment'));
      return;
    }
    if (window.Clover) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Clover SDK')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Clover SDK'));
    document.head.appendChild(script);
  });

  sdkLoadPromises.set(url, promise);
  return promise;
}

export function useCloverPayment({
  publicTokenizerKey,
  merchantId,
  environment,
  onError,
}: UseCloverPaymentOptions = {}): UseCloverPaymentReturn {
  const [card, setCard] = useState<CloverCard | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const mountedRef = useRef(true);
  const containerRef = useRef<HTMLElement | null>(null);
  const cloverRef = useRef<CloverInstance | null>(null);
  const elementsRef = useRef<CloverElement[]>([]);
  const onErrorRef = useRef(onError);

  onErrorRef.current = onError;

  const cleanupCard = useCallback(() => {
    for (const el of elementsRef.current) {
      try { el.unmount(); } catch { /* noop */ }
    }
    elementsRef.current = [];
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }
    containerRef.current = null;
    cloverRef.current = null;
    setCard(null);
    setIsInitialized(false);
    setError(null);
  }, []);

  const initializeCard = useCallback(async (container: HTMLDivElement) => {
    if (!container || !mountedRef.current) return;

    if (!publicTokenizerKey || !merchantId) {
      const errMsg = 'Clover payment configuration is incomplete';
      setError(errMsg);
      onErrorRef.current?.(errMsg);
      throw new Error(errMsg);
    }

    if (cloverRef.current) return;

    try {
      const env = environment === 'production' ? 'production' : 'sandbox';
      await loadCloverSdk(env);
      if (!mountedRef.current) return;
      if (!window.Clover) throw new Error('Clover SDK failed to load');

      const clover = new window.Clover(publicTokenizerKey, { merchantId });
      const elements = clover.elements();

      container.innerHTML = '';
      const fields: Array<{ type: string; id: string; label: string }> = [
        { type: 'CARD_NUMBER', id: 'lv-clover-card-number', label: 'Card Number' },
        { type: 'CARD_DATE', id: 'lv-clover-card-date', label: 'Expiration' },
        { type: 'CARD_CVV', id: 'lv-clover-card-cvv', label: 'CVV' },
        { type: 'CARD_POSTAL_CODE', id: 'lv-clover-card-postal', label: 'Postal Code' },
      ];
      const created: CloverElement[] = [];
      for (const f of fields) {
        const wrapper = document.createElement('div');
        wrapper.className = 'mb-3';
        const label = document.createElement('label');
        label.textContent = f.label;
        label.className = 'block text-sm font-medium mb-1';
        wrapper.appendChild(label);
        const mount = document.createElement('div');
        mount.id = f.id;
        mount.className = 'rounded-md border bg-background px-3 py-2 min-h-[40px]';
        wrapper.appendChild(mount);
        container.appendChild(wrapper);
        const el = elements.create(f.type);
        el.mount(`#${f.id}`);
        created.push(el);
      }

      cloverRef.current = clover;
      elementsRef.current = created;
      containerRef.current = container;

      const cardInstance: CloverCard = {
        async tokenize(): Promise<CloverTokenizeResult> {
          if (!cloverRef.current) {
            throw new Error('Card form not available');
          }
          const result = await cloverRef.current.createToken();
          if (result.errors && Object.keys(result.errors).length > 0) {
            const messages = Object.values(result.errors)
              .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
              .join('; ');
            throw new Error(messages || 'Card validation failed.');
          }
          if (!result.token) {
            throw new Error('Card validation failed. Please check your card details.');
          }
          return { token: result.token };
        },
        destroy() {
          cleanupCard();
        },
        async attach() {},
      };

      setCard(cardInstance);
      setIsInitialized(true);
      setError(null);
    } catch (err) {
      logger.error('useCloverPayment', 'Initialization error', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize payment form';
      if (mountedRef.current) {
        setError(errorMessage);
        setIsInitialized(false);
        onErrorRef.current?.(errorMessage);
        toast({
          title: 'Payment Form Notice',
          description: 'Credit card payment form unavailable. Please try another payment method.',
          variant: 'destructive',
        });
      }
    }
  }, [publicTokenizerKey, merchantId, environment, toast, cleanupCard]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupCard();
    };
  }, [cleanupCard]);

  return { card, isInitialized, error, initializeCard, cleanupCard };
}
