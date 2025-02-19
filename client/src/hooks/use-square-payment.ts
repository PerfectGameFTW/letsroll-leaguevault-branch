import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { initializeSquare } from "@/lib/square";

interface UseSquarePaymentOptions {
  onError?: (error: string) => void;
}

interface UseSquarePaymentReturn {
  card: any;
  isInitialized: boolean;
  error: string | null;
  initializeCard: (container: HTMLDivElement) => Promise<void>;
  cleanupCard: () => void;
}

export function useSquarePayment({ onError }: UseSquarePaymentOptions = {}): UseSquarePaymentReturn {
  const [card, setCard] = useState<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const mountedRef = useRef(true);
  const initializationAttempts = useRef(0);
  const maxAttempts = 3;

  // Cleanup function
  const cleanupCard = () => {
    if (card) {
      try {
        console.log('[useSquarePayment] Cleaning up card instance');
        card.destroy();
        setCard(null);
        setIsInitialized(false);
        setError(null);
        console.log('[useSquarePayment] Card cleanup completed');
      } catch (error) {
        console.error('[useSquarePayment] Error during cleanup:', error);
      }
    }
  };

  // Initialize card function with retry logic
  const initializeCard = async (container: HTMLDivElement) => {
    if (!container || !mountedRef.current) {
      console.error('[useSquarePayment] Container element is required or component unmounted');
      return;
    }

    if (!import.meta.env.VITE_SQUARE_LOCATION_ID) {
      const errorMessage = 'Square Location ID is not configured';
      console.error('[useSquarePayment]', errorMessage);
      setError(errorMessage);
      onError?.(errorMessage);
      return;
    }

    try {
      // Clean up existing card instance if any
      cleanupCard();

      console.log('[useSquarePayment] Initializing Square payments...');
      const payments = await initializeSquare();

      if (!mountedRef.current) {
        console.log('[useSquarePayment] Component unmounted during initialization');
        return;
      }

      console.log('[useSquarePayment] Creating new card form...');
      const newCard = await payments.card({
        environment: 'sandbox',
        locationId: import.meta.env.VITE_SQUARE_LOCATION_ID
      });

      console.log('[useSquarePayment] Attaching card to container...');
      await newCard.attach(container);

      if (mountedRef.current) {
        setCard(newCard);
        setIsInitialized(true);
        setError(null);
        initializationAttempts.current = 0;
        console.log('[useSquarePayment] Card form initialized successfully');
      } else {
        console.log('[useSquarePayment] Component unmounted during initialization, cleaning up');
        newCard.destroy();
      }
    } catch (error) {
      console.error('[useSquarePayment] Card initialization error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize payment form';

      if (mountedRef.current) {
        setError(errorMessage);
        setIsInitialized(false);

        if (initializationAttempts.current < maxAttempts) {
          initializationAttempts.current++;
          const delay = Math.min(1000 * Math.pow(2, initializationAttempts.current), 5000);
          console.log(`[useSquarePayment] Retrying initialization in ${delay}ms (attempt ${initializationAttempts.current}/${maxAttempts})`);

          // Schedule retry
          setTimeout(() => {
            if (mountedRef.current) {
              initializeCard(container);
            }
          }, delay);
        } else {
          // Reset attempts and notify of failure
          initializationAttempts.current = 0;
          onError?.(errorMessage);
          toast({
            title: "Payment Form Notice",
            description: "Credit card payment form unavailable. Please try again or choose a different payment method.",
            variant: "destructive",
          });
        }
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupCard();
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