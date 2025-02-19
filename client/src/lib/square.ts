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

    console.log('[Square] Starting payment process for amount:', amount);

    console.log('[Square] Tokenizing card...');
    const result = await cardInstance.tokenize();

    if (result.status === 'OK') {
      console.log('[Square] Card tokenized successfully');

      const response = await fetch('/api/square/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceId: result.token,
          amount,
          locationId: import.meta.env.VITE_SQUARE_LOCATION_ID,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Square] Payment processing failed:', errorText);
        throw new Error(errorText || 'Payment processing failed');
      }

      const payment = await response.json();
      console.log('[Square] Payment processed successfully:', {
        paymentId: payment.id,
        status: payment.status,
        cardLast4: payment.card?.last4,
        cardBrand: payment.card?.brand
      });

      return payment;
    } else {
      console.error('[Square] Card tokenization failed:', result.errors);
      throw new Error(result.errors[0]?.message || 'Card tokenization failed');
    }
  } catch (error) {
    console.error('[Square] Error processing payment:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      amount
    });
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