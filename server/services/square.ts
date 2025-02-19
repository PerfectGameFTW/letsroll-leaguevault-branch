import { Client } from 'square';

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

// Initialize Square client using dynamic import
let squareClient: any = null;

async function initializeSquareClient() {
  if (!squareClient && process.env.SQUARE_ACCESS_TOKEN) {
    try {
      const { Client } = await import('square');
      squareClient = new Client({
        accessToken: process.env.SQUARE_ACCESS_TOKEN,
        environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'
      });
      console.log('[Square] Client initialized successfully');
    } catch (error) {
      console.error('[Square] Failed to initialize client:', error);
      throw new Error('Failed to initialize Square client: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }
  return squareClient;
}

export async function processPayment(sourceId: string, amount: number, locationId: string): Promise<{
  id: string;
  status: string;
  card: {
    last4: string;
    brand: string;
  };
}> {
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    throw new Error("Square access token not configured");
  }

  const client = await initializeSquareClient();
  if (!client) {
    throw new Error("Square client not initialized. Please check your credentials.");
  }

  console.log('[Square] Processing payment:', { sourceId, amount, locationId });

  try {
    // Validate inputs
    if (!sourceId || !amount || !locationId) {
      throw new Error("Missing required payment parameters");
    }

    const paymentRequest = {
      sourceId,
      idempotencyKey: `${Date.now()}-${Math.random()}`,
      amountMoney: {
        amount: BigInt(amount),
        currency: 'USD'
      },
      locationId,
    };

    console.log('[Square] Sending payment request:', paymentRequest);
    const response = await client.paymentsApi.createPayment(paymentRequest);

    if (!response?.result?.payment) {
      console.error('[Square] Payment creation failed:', response);
      throw new Error("Payment creation failed. Please try again.");
    }

    const payment = response.result.payment;
    console.log('[Square] Payment processed successfully:', payment);

    return {
      id: payment.id ?? '',
      status: payment.status ?? 'UNKNOWN',
      card: {
        last4: payment.cardDetails?.card?.last4 ?? '****',
        brand: payment.cardDetails?.card?.cardBrand ?? 'UNKNOWN'
      }
    };
  } catch (error) {
    console.error('[Square] Payment processing error:', error);

    // Ensure we return a proper error message
    if (error instanceof Error) {
      throw new Error(`Payment processing failed: ${error.message}`);
    } else {
      throw new Error('An unexpected error occurred during payment processing');
    }
  }
}

export default {
  processPayment
};