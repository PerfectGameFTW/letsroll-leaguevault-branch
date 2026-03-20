import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { initializeSquare, resetSquarePayments, getPreWarmedCard, cardStyle } from "@/lib/square";

interface UseSquarePaymentOptions {
  onError?: (error: string) => void;
  locationId?: number | null;
}

interface UseSquarePaymentReturn {
  card: any;
  isInitialized: boolean;
  error: string | null;
  initializeCard: (container: HTMLDivElement) => Promise<void>;
  cleanupCard: () => void;
}

export function useSquarePayment({ onError, locationId }: UseSquarePaymentOptions = {}): UseSquarePaymentReturn {
  const [card, setCard] = useState<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const mountedRef = useRef(true);
  const cardRef = useRef<any>(null);
  const initializingRef = useRef(false);
  const initializationAttempts = useRef(0);
  const onErrorRef = useRef(onError);
  const locationIdRef = useRef(locationId);
  const maxAttempts = 3;

  onErrorRef.current = onError;
  locationIdRef.current = locationId;

  const cleanupCard = useCallback(() => {
    if (cardRef.current) {
      try {
        cardRef.current.destroy();
      } catch (e) {
        console.error('[useSquarePayment] Error during cleanup:', e);
      }
      cardRef.current = null;
    }
    initializingRef.current = false;
    resetSquarePayments();
    setCard(null);
    setIsInitialized(false);
    setError(null);
  }, []);

  const initializeCard = useCallback(async (container: HTMLDivElement) => {
    if (!container || !mountedRef.current) {
      return;
    }

    if (cardRef.current || initializingRef.current) {
      return;
    }

    initializingRef.current = true;

    try {
      const initTimeout = setTimeout(() => {
        if (mountedRef.current && !cardRef.current) {
          setError('Card initialization timed out');
          initializingRef.current = false;

          if (initializationAttempts.current < maxAttempts) {
            initializationAttempts.current++;
          } else {
            initializationAttempts.current = 0;
            onErrorRef.current?.('Credit card form initialization timed out');
            toast({
              title: "Payment Form Notice",
              description: "Credit card payment form unavailable. Please try another payment method.",
              variant: "destructive",
            });
          }
        }
      }, 8000);

      const payments = await initializeSquare(locationIdRef.current);

      if (!mountedRef.current) {
        clearTimeout(initTimeout);
        initializingRef.current = false;
        return;
      }

      let newCard = getPreWarmedCard();
      if (!newCard) {
        newCard = await payments.card({ style: cardStyle });
      }

      await newCard.attach(container);
      clearTimeout(initTimeout);

      if (mountedRef.current) {
        cardRef.current = newCard;
        setCard(newCard);
        setIsInitialized(true);
        setError(null);
        initializationAttempts.current = 0;
        initializingRef.current = false;
      } else {
        newCard.destroy();
        initializingRef.current = false;
      }
    } catch (err) {
      console.error('[useSquarePayment] Card initialization error:', err);
      initializingRef.current = false;
      const errorMessage = err instanceof Error
        ? err.message
        : 'Failed to initialize payment form';

      if (mountedRef.current) {
        setError(errorMessage);
        setIsInitialized(false);

        if (initializationAttempts.current < maxAttempts) {
          initializationAttempts.current++;
          const delay = Math.min(1000 * Math.pow(2, initializationAttempts.current), 5000);

          setTimeout(() => {
            if (mountedRef.current) {
              initializeCard(container);
            }
          }, delay);
        } else {
          initializationAttempts.current = 0;
          onErrorRef.current?.(errorMessage);
          if (errorMessage.includes('failed to load') || errorMessage.includes('not properly loaded')) {
            toast({
              title: "Square Environment Mismatch",
              description: "The payment form couldn't initialize due to a configuration mismatch. Please contact support for assistance.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Payment Form Notice",
              description: "Credit card payment form unavailable. Please try again or choose a different payment method.",
              variant: "default",
            });
          }
        }
      }
    }
  }, [toast, cleanupCard]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (cardRef.current) {
        try {
          cardRef.current.destroy();
        } catch (e) {
          console.error('[useSquarePayment] Error during unmount cleanup:', e);
        }
        cardRef.current = null;
      }
      initializingRef.current = false;
      resetSquarePayments();
    };
  }, []);

  return {
    card,
    isInitialized,
    error,
    initializeCard,
    cleanupCard,
  };
}
