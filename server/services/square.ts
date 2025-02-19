import { ApiError, Client as SquareClient, Environment } from '@square/sdk';

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

// Initialize Square client
let squareClient: SquareClient | null = null;

function initializeSquareClient(): SquareClient {
  if (!squareClient && process.env.SQUARE_ACCESS_TOKEN) {
    try {
      squareClient = new SquareClient({
        accessToken: process.env.SQUARE_ACCESS_TOKEN,
        environment: process.env.NODE_ENV === 'production' ? Environment.Production : Environment.Sandbox
      });
      console.log('[Square] Client initialized successfully');
    } catch (error) {
      console.error('[Square] Failed to initialize client:', error);
      throw new Error('Failed to initialize Square client: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  if (!squareClient) {
    throw new Error("Square client not initialized. Please check your credentials.");
  }

  return squareClient;
}

export async function processPayment(sourceId: string, amount: number, locationId: string = process.env.SQUARE_LOCATION_ID!): Promise<{
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

  if (!locationId) {
    throw new Error("Square location ID not configured");
  }

  const client = initializeSquareClient();
  console.log('[Square] Processing payment:', { sourceId, amount, locationId });

  try {
    // Validate inputs
    if (!sourceId || !amount) {
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

    if (error instanceof ApiError) {
      throw new Error(`Payment processing failed: ${error.result.errors?.[0]?.detail ?? error.message}`);
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error('An unexpected error occurred during payment processing');
    }
  }
}

export default {
  processPayment
};