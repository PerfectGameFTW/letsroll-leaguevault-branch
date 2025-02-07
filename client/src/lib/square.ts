import { loadScript } from "@/lib/utils";

declare global {
  interface Window {
    Square: any;
  }
}

let payments: any = null;

export async function initializeSquare() {
  if (!payments) {
    await loadScript("https://sandbox.web.squarecdn.com/v1/square.js");
    if (!import.meta.env.VITE_SQUARE_APP_ID || !import.meta.env.VITE_SQUARE_LOCATION_ID) {
      throw new Error("Square credentials are not configured");
    }
    payments = await window.Square.payments(
      import.meta.env.VITE_SQUARE_APP_ID,
      import.meta.env.VITE_SQUARE_LOCATION_ID
    );
  }
  return payments;
}

export async function createPayment(amount: number) {
  try {
    const payments = await initializeSquare();
    const card = await payments.card();
    await card.attach('#card-container');

    const result = await card.tokenize();
    if (result.status === 'OK') {
      const response = await fetch('/api/payments/process', {
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
        throw new Error(error || 'Payment processing failed');
      }

      const payment = await response.json();
      return {
        id: payment.id,
        status: payment.status
      };
    } else {
      throw new Error(result.errors[0].message);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while processing payment');
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