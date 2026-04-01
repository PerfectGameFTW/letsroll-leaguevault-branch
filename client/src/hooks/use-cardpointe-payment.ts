import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

export interface CardPointeTokenizeResult {
  token: string;
}

export interface CardPointeCard {
  tokenize(): Promise<CardPointeTokenizeResult>;
  destroy(): void;
  attach(container: HTMLElement): Promise<void>;
}

interface UseCardPointePaymentOptions {
  tokenizerUrl?: string | null;
  onError?: (error: string) => void;
}

interface UseCardPointePaymentReturn {
  card: CardPointeCard | null;
  isInitialized: boolean;
  error: string | null;
  initializeCard: (container: HTMLDivElement) => Promise<void>;
  cleanupCard: () => void;
}

export function useCardPointePayment({ tokenizerUrl, onError }: UseCardPointePaymentOptions = {}): UseCardPointePaymentReturn {
  const [card, setCard] = useState<CardPointeCard | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const mountedRef = useRef(true);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const tokenResolverRef = useRef<((result: CardPointeTokenizeResult) => void) | null>(null);
  const tokenRejecterRef = useRef<((error: Error) => void) | null>(null);
  const onErrorRef = useRef(onError);

  onErrorRef.current = onError;

  const cleanupCard = useCallback(() => {
    if (iframeRef.current && containerRef.current) {
      try {
        containerRef.current.removeChild(iframeRef.current);
      } catch {}
    }
    iframeRef.current = null;
    containerRef.current = null;
    tokenResolverRef.current = null;
    tokenRejecterRef.current = null;
    setCard(null);
    setIsInitialized(false);
    setError(null);
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data) return;

      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
        return;
      }

      if (tokenizerUrl) {
        try {
          const tokenizerOrigin = new URL(tokenizerUrl).origin;
          if (event.origin !== tokenizerOrigin) return;
        } catch {}
      }

      let data = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }

      if (data.token !== undefined) {
        const token = String(data.token).trim();
        if (token && token !== '0' && tokenResolverRef.current) {
          tokenResolverRef.current({ token });
          tokenResolverRef.current = null;
          tokenRejecterRef.current = null;
        } else if ((!token || token === '0') && tokenRejecterRef.current) {
          tokenRejecterRef.current(new Error('Card validation failed. Please check your card details.'));
          tokenResolverRef.current = null;
          tokenRejecterRef.current = null;
        }
      }

      if (data.validationError) {
        if (tokenRejecterRef.current) {
          tokenRejecterRef.current(new Error(data.validationError));
          tokenResolverRef.current = null;
          tokenRejecterRef.current = null;
        }
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [tokenizerUrl]);

  const initializeCard = useCallback(async (container: HTMLDivElement) => {
    if (!container || !mountedRef.current) {
      return;
    }

    if (!tokenizerUrl) {
      const errMsg = 'CardPointe tokenizer URL not configured';
      setError(errMsg);
      onErrorRef.current?.(errMsg);
      throw new Error(errMsg);
    }

    if (iframeRef.current) return;

    try {
      const iframe = document.createElement('iframe');
      iframe.src = tokenizerUrl + '?usecvv=true&cardnumber=true&expirydate=true&invalidinputevent=true&enhancedresponse=true&formatinput=true';
      iframe.style.width = '100%';
      iframe.style.minHeight = '180px';
      iframe.style.border = 'none';
      iframe.style.overflow = 'hidden';
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('scrolling', 'no');

      const loadPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('CardPointe tokenizer timed out')), 10000);
        iframe.onload = () => {
          clearTimeout(timeout);
          resolve();
        };
        iframe.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Failed to load CardPointe tokenizer'));
        };
      });

      container.appendChild(iframe);
      iframeRef.current = iframe;
      containerRef.current = container;

      await loadPromise;

      if (!mountedRef.current) {
        cleanupCard();
        return;
      }

      const cardInstance: CardPointeCard = {
        async tokenize(): Promise<CardPointeTokenizeResult> {
          return new Promise((resolve, reject) => {
            tokenResolverRef.current = resolve;
            tokenRejecterRef.current = reject;

            const timeout = setTimeout(() => {
              tokenRejecterRef.current = null;
              tokenResolverRef.current = null;
              reject(new Error('Tokenization timed out. Please try again.'));
            }, 15000);

            const origResolve = resolve;
            const origReject = reject;
            tokenResolverRef.current = (result) => {
              clearTimeout(timeout);
              origResolve(result);
            };
            tokenRejecterRef.current = (err) => {
              clearTimeout(timeout);
              origReject(err);
            };

            if (iframeRef.current?.contentWindow) {
              const targetOrigin = tokenizerUrl ? new URL(tokenizerUrl).origin : '*';
              iframeRef.current.contentWindow.postMessage('getToken', targetOrigin);
            } else {
              clearTimeout(timeout);
              reject(new Error('Card form not available'));
            }
          });
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
      console.error('[useCardPointePayment] Initialization error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize payment form';
      if (mountedRef.current) {
        setError(errorMessage);
        setIsInitialized(false);
        onErrorRef.current?.(errorMessage);
        toast({
          title: "Payment Form Notice",
          description: "Credit card payment form unavailable. Please try another payment method.",
          variant: "destructive",
        });
      }
    }
  }, [tokenizerUrl, toast, cleanupCard]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupCard();
    };
  }, [cleanupCard]);

  return {
    card,
    isInitialized,
    error,
    initializeCard,
    cleanupCard,
  };
}
