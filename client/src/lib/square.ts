import { loadScript } from "@/lib/utils";

interface PaymentResult {
  id: string;
  status: string;
  card?: {
    last4: string;
    brand: string;
  };
}

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

declare global {
  interface Window {
    Square: {
      payments: (appId: string, locationId: string) => Promise<any>;
    };
  }
}

let payments: any = null;
let initializationPromise: Promise<any> | null = null;

export async function initializeSquare() {
  try {
    // Return existing initialization promise if it exists
    if (initializationPromise) {
      console.log('[Square] Using existing initialization promise');
      return initializationPromise;
    }

    // Create new initialization promise
    initializationPromise = (async () => {
      if (!payments) {
        console.log('[Square] Starting Square SDK initialization...');

        if (!import.meta.env.VITE_SQUARE_APP_ID || !import.meta.env.VITE_SQUARE_LOCATION_ID) {
          console.error('[Square] Missing required Square credentials');
          throw new Error("Square credentials are not properly configured");
        }

        try {
          console.log('[Square] Loading Square SDK from CDN...');
          await loadScript("https://sandbox.web.squarecdn.com/v1/square.js");
          console.log('[Square] Square SDK loaded successfully');
        } catch (error) {
          console.error('[Square] Failed to load Square SDK:', error);
          throw new Error("Failed to load Square SDK: " + (error instanceof Error ? error.message : String(error)));
        }

        console.log('[Square] Initializing Square payments with provided credentials');
        try {
          payments = await window.Square.payments(
            import.meta.env.VITE_SQUARE_APP_ID,
            import.meta.env.VITE_SQUARE_LOCATION_ID
          );
          console.log('[Square] Square payments initialized successfully');
        } catch (error) {
          console.error('[Square] Failed to initialize Square payments:', error);
          throw new Error("Failed to initialize Square payments: " + (error instanceof Error ? error.message : String(error)));
        }
      }

      return payments;
    })();

    return initializationPromise;
  } catch (error) {
    console.error('[Square] Critical error during Square initialization:', error);
    initializationPromise = null;
    throw error;
  }
}

export async function createPayment(amount: number, cardInstance: any): Promise<PaymentResult> {
  try {
    if (!cardInstance) {
      console.error('[Square] Card form not initialized');
      throw new Error("Card form not initialized");
    }

    // Ensure amount is a positive integer
    if (amount <= 0 || !Number.isInteger(amount)) {
      console.error('[Square] Invalid payment amount:', amount);
      throw new Error("Invalid payment amount");
    }

    // Verify required environment variables
    if (!import.meta.env.VITE_SQUARE_APP_ID || !import.meta.env.VITE_SQUARE_LOCATION_ID) {
      console.error('[Square] Missing required Square credentials');
      throw new Error("Square credentials are not properly configured");
    }

    console.log('[Square] Starting payment process for amount:', amount);
    console.log('[Square] Tokenizing card...');

    const result = await cardInstance.tokenize();
    console.log('[Square] Tokenization result:', {
      status: result.status,
      hasErrors: !!result.errors,
      token: result.token ? 'present' : 'missing'
    });

    if (result.status === 'OK' && result.token) {
      console.log('[Square] Card tokenized successfully, sending to server...');

      const paymentData = {
        sourceId: result.token,
        amount,
        locationId: import.meta.env.VITE_SQUARE_LOCATION_ID,
      };

      console.log('[Square] Payment request data:', {
        ...paymentData,
        sourceId: 'hidden-for-security'
      });

      const response = await fetch('/api/square/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[Square] Server payment error:', errorData);
        throw new Error(errorData.error?.message || 'Payment processing failed');
      }

      const responseData = await response.json();
      console.log('[Square] Server response:', {
        status: response.status,
        ok: response.ok,
        data: responseData
      });

      if (!responseData.status || responseData.status !== 'COMPLETED') {
        console.error('[Square] Payment not completed:', responseData);
        throw new Error("Payment was not completed successfully");
      }

      console.log('[Square] Payment processed successfully:', {
        paymentId: responseData.id,
        status: responseData.status,
        cardLast4: responseData.card?.last4,
        cardBrand: responseData.card?.brand
      });

      return responseData;
    } else {
      const errors = result.errors || [];
      const errorMessage = errors.map(e => e.message).join(', ') || 'Card tokenization failed';
      console.error('[Square] Card tokenization failed:', {
        errors,
        firstError: errorMessage
      });
      throw new Error(errorMessage);
    }
  } catch (error) {
    console.error('[Square] Payment error:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      amount
    });

    // Re-throw with a more user-friendly message
    throw new Error('Payment processing failed: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export async function createSquareCustomer(name: string, email: string, teamId: number): Promise<SquareCustomer> {
  try {
    console.log('[Square] Creating customer:', { name, email, teamId });
    const response = await fetch('/api/square/customers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, email, teamId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Square] Failed to create customer:', errorText);
      throw new Error(errorText || 'Failed to create Square customer');
    }

    const customer = await response.json();
    console.log('[Square] Customer created successfully:', {
      customerId: customer.id,
      name: customer.name
    });

    return customer;
  } catch (error) {
    console.error('[Square] Error creating customer:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      input: { name, email, teamId }
    });
    throw new Error('Failed to create Square customer: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export function getSquareCustomerUrl(customerId: string): string {
  return `https://squareup.com/dashboard/customers/${customerId}`;
}

export async function enrollInLoyalty(customerId: string) {
  try {
    console.log('[Square] Enrolling customer in loyalty program:', customerId);
    const response = await fetch('/api/square/loyalty/enroll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customerId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Square] Failed to enroll in loyalty program:', errorText);
      throw new Error(errorText || 'Failed to enroll in loyalty program');
    }

    const result = await response.json();
    console.log('[Square] Successfully enrolled in loyalty program:', result);
    return result;
  } catch (error) {
    console.error('[Square] Error enrolling in loyalty program:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      customerId
    });
    throw new Error('Failed to enroll in loyalty program: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export async function getLoyaltyPoints(customerId: string) {
  try {
    console.log('[Square] Fetching loyalty points for customer:', customerId);
    const response = await fetch(`/api/square/loyalty/points/${customerId}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Square] Failed to get loyalty points:', errorText);
      throw new Error(errorText || 'Failed to get loyalty points');
    }

    const result = await response.json();
    console.log('[Square] Successfully retrieved loyalty points:', result);
    return result;
  } catch (error) {
    console.error('[Square] Error getting loyalty points:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      customerId
    });
    throw new Error('Failed to get loyalty points: ' + (error instanceof Error ? error.message : String(error)));
  }
}