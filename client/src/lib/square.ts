import { loadScript } from "@/lib/utils";

declare global {
  interface Window {
    Square: any;
  }
}

let payments: any = null;
let card: any = null;

export async function initializeSquare() {
  try {
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

    // Retry finding card container with exponential backoff
    let retries = 5;
    let delay = 100;
    let cardContainer = null;

    while (retries > 0 && !cardContainer) {
      cardContainer = document.getElementById('card-container');
      if (!cardContainer) {
        console.log(`[Square] Card container not found, retrying in ${delay}ms... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
        retries--;
      }
    }

    if (!cardContainer) {
      console.error('[Square] Card container element not found after all retries');
      throw new Error("Card container element not found after multiple attempts");
    }

    // Always cleanup existing card instance before creating new one
    console.log('[Square] Creating new card form...');
    if (card) {
      console.log('[Square] Cleaning up existing card instance before creating new one');
      await cleanupCard();
    }

    card = await payments.card();
    console.log('[Square] Attaching card to container...');
    await card.attach('#card-container');
    console.log('[Square] Card form attached successfully');

    return payments;
  } catch (error) {
    console.error('[Square] Error initializing Square:', error);
    throw error;
  }
}

export async function createPayment(amount: number) {
  try {
    if (!card) {
      console.error('[Square] Card form not initialized');
      throw new Error("Card form not initialized");
    }

    console.log('[Square] Tokenizing card...');
    const result = await card.tokenize();
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
      console.log('[Square] Payment processed:', payment);
      return {
        id: payment.id,
        status: payment.status
      };
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

// Clean up the card instance
export function cleanupCard() {
  if (card) {
    try {
      console.log('[Square] Cleaning up card instance');
      card.destroy();
      card = null;
      console.log('[Square] Card instance destroyed successfully');
    } catch (error) {
      console.error('[Square] Error destroying card instance:', error);
    }
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