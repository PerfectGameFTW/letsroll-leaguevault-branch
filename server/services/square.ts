import { ApiError, Client } from 'square';

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

// Initialize Square client
let squareClient: Client | null = null;

function initializeSquareClient(): Client {
  try {
    if (!process.env.SQUARE_ACCESS_TOKEN) {
      console.log('[Square] Using development mode with sandbox credentials');
      // In development/sandbox mode, we can proceed with limited functionality
      return new Client({
        accessToken: 'sandbox-token',
        environment: 'sandbox'
      });
    }

    if (!squareClient) {
      squareClient = new Client({
        accessToken: process.env.SQUARE_ACCESS_TOKEN,
        environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'
      });
      console.log('[Square] Client initialized successfully');
    }

    return squareClient;
  } catch (error) {
    console.error('[Square] Client initialization error:', error);
    throw new Error('Failed to initialize Square client: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
}

export async function processPayment(sourceId: string, amount: number, locationId: string = process.env.SQUARE_LOCATION_ID!): Promise<{
  id: string;
  status: string;
  card: {
    last4: string;
    brand: string;
  };
}> {
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
      const errorDetail = error.result?.errors?.[0]?.detail;
      const errorCode = error.result?.errors?.[0]?.code;
      throw new Error(`Payment processing failed: ${errorDetail ?? error.message} (Code: ${errorCode})`);
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