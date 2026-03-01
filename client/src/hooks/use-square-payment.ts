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
        card.destroy();
        setCard(null);
        setIsInitialized(false);
        setError(null);
      } catch (error) {
        console.error('[useSquarePayment] Error during cleanup:', error);
      }
    }
  };

  // Initialize card function with improved reliability
  const initializeCard = async (container: HTMLDivElement) => {
    if (!container || !mountedRef.current) {
      return;
    }

    // Protection against initialization when already initialized
    if (card && isInitialized) {
      return;
    }

    try {
      // Clean up existing card instance if any
      cleanupCard();
      
      // Set a timeout to automatically fail if initialization takes too long
      const initTimeout = setTimeout(() => {
        if (mountedRef.current && !isInitialized) {
          setError('Card initialization timed out');
          
          if (initializationAttempts.current < maxAttempts) {
            initializationAttempts.current++;
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
      
      const payments = await initializeSquare();

      if (!mountedRef.current) {
        clearTimeout(initTimeout);
        return;
      }
      
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

      await newCard.attach(container);
      clearTimeout(initTimeout);

      if (mountedRef.current) {
        setCard(newCard);
        setIsInitialized(true);
        setError(null);
        initializationAttempts.current = 0;
      } else {
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