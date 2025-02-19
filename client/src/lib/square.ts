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
      return initializationPromise;
    }

    // Create new initialization promise
    initializationPromise = (async () => {
      if (!payments) {
        console.log('[Square] Loading Square SDK...');
        await loadScript("https://sandbox.web.squarecdn.com/v1/square.js");

        if (!import.meta.env.VITE_SQUARE_APP_ID || !import.meta.env.VITE_SQUARE_LOCATION_ID) {
          console.error('[Square] Missing Square credentials');
          throw new Error("Square credentials are not configured");
        }

        console.log('[Square] Initializing Square payments...');
        payments = await window.Square.payments(
          import.meta.env.VITE_SQUARE_APP_ID,
          import.meta.env.VITE_SQUARE_LOCATION_ID
        );
        console.log('[Square] Square payments initialized successfully');
      }

      return payments;
    })();

    return initializationPromise;
  } catch (error) {
    console.error('[Square] Error initializing Square:', error);
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
        const error = await response.text();
        console.error('[Square] Payment processing failed:', error);
        throw new Error(error || 'Payment processing failed');
      }

      const payment = await response.json();
      console.log('[Square] Payment processed successfully:', payment);
      return payment;
    } else {
      console.error('[Square] Card tokenization failed:', result.errors);
      throw new Error(result.errors[0].message);
    }
  } catch (error) {
    console.error('[Square] Error processing payment:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while processing payment');
  }
}

export async function createSquareCustomer(name: string, email: string, teamId: number): Promise<SquareCustomer> {
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
    console.error('[Square] Error creating customer:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while creating Square customer');
  }
}

export function getSquareCustomerUrl(customerId: string): string {
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