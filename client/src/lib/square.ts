import { loadScript } from "@/lib/utils";

declare global {
  interface Window {
    Square: any;
  }
}

let payments: any = null;
let initializationPromise: Promise<any> | null = null;

export async function initializeSquare() {
  try {
    // Return existing initialization promise if it exists
    if (initializationPromise) {
      return initializationPromise;
    }

    // Create new initialization promise
    initializationPromise = (async () => {
      if (!payments) {
        console.log('[Square] Loading Square SDK...');
        await loadScript("https://sandbox.web.squarecdn.com/v1/square.js");

        const appId = import.meta.env.VITE_SQUARE_APP_ID;
        const locationId = import.meta.env.VITE_SQUARE_LOCATION_ID;

        if (!appId || !locationId) {
          console.error('[Square] Missing credentials:', { appId: !!appId, locationId: !!locationId });
          throw new Error("Square credentials are not properly configured. Please check your environment variables.");
        }

        try {
          console.log('[Square] Initializing payments with app ID and location...');
          payments = await window.Square.payments(appId, locationId);
          console.log('[Square] Payments initialized successfully');
        } catch (error) {
          console.error('[Square] Failed to initialize payments:', error);
          throw new Error("Failed to initialize Square payments. Please ensure your credentials are correct.");
        }
      }

      return payments;
    })();

    return initializationPromise;
  } catch (error) {
    console.error('[Square] Error in Square initialization:', error);
    initializationPromise = null;
    throw error instanceof Error ? error : new Error('Failed to initialize Square payments');
  }
}

export async function createPayment(amount: number, cardInstance: any) {
  try {
    if (!cardInstance) {
      throw new Error("Card form not initialized. Please refresh and try again.");
    }

    console.log('[Square] Starting payment process...');
    console.log('[Square] Tokenizing card...');
    const result = await cardInstance.tokenize();

    if (result.status === 'OK') {
      console.log('[Square] Card tokenized successfully');

      const locationId = import.meta.env.VITE_SQUARE_LOCATION_ID;
      if (!locationId) {
        throw new Error("Square location ID is not configured");
      }

      console.log('[Square] Sending payment request to server...');
      const response = await fetch('/api/square/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceId: result.token,
          amount,
          locationId,
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Payment processing failed';
        try {
          const errorData = await response.json();
          errorMessage = errorData?.error?.message || errorMessage;
        } catch (e) {
          try {
            const errorText = await response.text();
            console.error('[Square] Non-JSON error response:', errorText);
            errorMessage = errorText || 'Unable to process payment. Please try again.';
          } catch (textError) {
            console.error('[Square] Failed to read error response');
          }
        }
        throw new Error(errorMessage);
      }

      const payment = await response.json();
      console.log('[Square] Payment processed successfully:', payment);
      return payment.data;
    } else {
      console.error('[Square] Card tokenization failed:', result);
      throw new Error(result.errors?.[0]?.message || "Failed to process card information. Please check your card details and try again.");
    }
  } catch (error) {
    console.error('[Square] Payment processing error:', error);
    throw error instanceof Error ? error : new Error('An unexpected error occurred while processing your payment');
  }
}

export async function createSquareCustomer(name: string, email: string, teamId: number) {
  try {
    const response = await fetch('/api/square/customers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, email, teamId }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || 'Failed to create Square customer');
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while creating Square customer');
  }
}

export function getSquareCustomerUrl(customerId: string) {
  // This URL format might need to be adjusted based on your Square account setup
  return `https://squareup.com/dashboard/customers/${customerId}`;
}

export async function enrollInLoyalty(customerId: string) {
  try {
    const response = await fetch('/api/square/loyalty/enroll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customerId }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || 'Failed to enroll in loyalty program');
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while enrolling in loyalty program');
  }
}

export async function getLoyaltyPoints(customerId: string) {
  try {
    const response = await fetch(`/api/square/loyalty/points/${customerId}`);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || 'Failed to get loyalty points');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while getting loyalty points');
  }
}