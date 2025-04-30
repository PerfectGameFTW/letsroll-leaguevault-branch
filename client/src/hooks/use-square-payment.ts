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

  // Initialize card function with improved reliability
  const initializeCard = async (container: HTMLDivElement) => {
    if (!container || !mountedRef.current) {
      console.error('[useSquarePayment] Container element is required or component unmounted');
      return;
    }

    // Protection against initialization when already initialized
    if (card && isInitialized) {
      console.log('[useSquarePayment] Card already initialized, skipping initialization');
      return;
    }

    try {
      // Clean up existing card instance if any
      cleanupCard();

      console.log('[useSquarePayment] Initializing Square payments...');
      
      // Set a timeout to automatically fail if initialization takes too long
      const initTimeout = setTimeout(() => {
        if (mountedRef.current && !isInitialized) {
          console.error('[useSquarePayment] Card initialization timed out after 8 seconds');
          setError('Card initialization timed out');
          
          if (initializationAttempts.current < maxAttempts) {
            initializationAttempts.current++;
            console.log(`[useSquarePayment] Will retry initialization (attempt ${initializationAttempts.current}/${maxAttempts})`);
          } else {
            // Max retries reached
            initializationAttempts.current = 0;
            const timeoutError = 'Credit card form initialization timed out';
            onError?.(timeoutError);
            toast({
              title: "Payment Form Notice",
              description: "Credit card payment form unavailable. Please try another payment method.",
              variant: "destructive",
            });
          }
        }
      }, 8000);
      
      console.log('[useSquarePayment] Checking environment variables...');
      console.log('[useSquarePayment] App ID present:', !!import.meta.env.VITE_SQUARE_APP_ID);
      console.log('[useSquarePayment] Location ID present:', !!import.meta.env.VITE_SQUARE_LOCATION_ID);
      
      const payments = await initializeSquare();

      if (!mountedRef.current) {
        console.log('[useSquarePayment] Component unmounted during initialization');
        clearTimeout(initTimeout);
        return;
      }

      console.log('[useSquarePayment] Square payments initialized successfully');
      console.log('[useSquarePayment] Creating new card form...');
      
      // Create card payment form
      const newCard = await payments.card({
        // Add some configuration options for better user experience
        style: {
          input: {
            backgroundColor: '#FFFFFF',
            fontSize: '14px',
            color: '#333333',
          },
          'input.is-focus': {
            backgroundColor: '#FAFAFA',
          },
          '.input-container': {
            borderColor: '#DDDDDD',  
          },
          '.input-container.is-focus': {
            borderColor: '#888888',
          },
          '.input-container.is-error': {
            borderColor: '#CC0023',
          },
        }
      });

      console.log('[useSquarePayment] Attaching card to container...');
      await newCard.attach(container);
      clearTimeout(initTimeout);

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
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Failed to initialize payment form';

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
          // Check for common environment mismatch error
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