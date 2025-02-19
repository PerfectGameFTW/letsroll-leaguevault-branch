import { ApiError, Client } from 'square';

interface PaymentResult {
  id: string;
  status: string;
  card: {
    last4: string;
    brand: string;
  };
}

// Initialize Square client
let squareClient: Client | null = null;

function initializeSquareClient(): Client {
  try {
    if (!squareClient) {
      squareClient = new Client({
        accessToken: process.env.SQUARE_ACCESS_TOKEN || 'sandbox-token',
        environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'
      });
      console.log('[Square] Client initialized successfully');
    }
    return squareClient;
  } catch (error) {
    console.error('[Square] Client initialization error:', error);
    throw error instanceof Error ? error : new Error('Failed to initialize Square client');
  }
}

export async function processPayment(sourceId: string, amount: number, locationId: string = process.env.SQUARE_LOCATION_ID!): Promise<PaymentResult> {
  if (!locationId) {
    throw new Error("Square location ID not configured");
  }

  const client = initializeSquareClient();
  console.log('[Square] Processing payment:', { sourceId, amount, locationId });

  try {
    const paymentBody = {
      sourceId,
      idempotencyKey: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      amountMoney: {
        amount: BigInt(amount),
        currency: 'USD'
      },
      locationId,
    };

    console.log('[Square] Sending payment request:', paymentBody);
    const response = await client.paymentsApi.createPayment(paymentBody);

    if (!response?.result?.payment) {
      throw new Error("Payment creation failed");
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
    } 
    throw error instanceof Error ? error : new Error('An unexpected error occurred during payment processing');
  }
}

export default {
  processPayment
};