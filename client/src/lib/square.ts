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
    throw new Error('Failed to initialize Square payments: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
}

export async function createPayment(amount: number, cardInstance: any) {
  if (!cardInstance) {
    throw new Error("Card form not initialized");
  }

  try {
    console.log('[Square] Starting payment process for amount:', amount);

    // Tokenize the card
    console.log('[Square] Tokenizing card...');
    const result = await cardInstance.tokenize();

    if (result.status !== 'OK') {
      console.error('[Square] Card tokenization failed:', result.errors);
      throw new Error(result.errors[0].message);
    }

    console.log('[Square] Card tokenized successfully');

    // Make payment request
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
      const errorData = await response.json();
      console.error('[Square] Payment request failed:', errorData);
      throw new Error(errorData.error?.message || 'Payment processing failed');
    }

    const responseData = await response.json();
    console.log('[Square] Payment response:', responseData);

    if (!responseData.success) {
      throw new Error(responseData.error?.message || 'Payment was not successful');
    }

    return {
      id: responseData.data.id,
      status: responseData.data.status
    };
  } catch (error) {
    console.error('[Square] Payment processing error:', error);
    throw error instanceof Error ? error : new Error('An unexpected error occurred');
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