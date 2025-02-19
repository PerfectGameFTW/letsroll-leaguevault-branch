
import { Square } from 'square';
import type { ApiError } from 'square/dist/types';

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

// Initialize Square client
let squareClient: Square | null = null;

function initializeSquareClient(): Square {
  try {
    if (!process.env.SQUARE_ACCESS_TOKEN) {
      console.log('[Square] Using development mode with sandbox credentials');
      return new Square.Client({
        accessToken: 'sandbox-token',
        environment: 'sandbox'
      });
    }

    if (!squareClient) {
      squareClient = new Square({
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

export async function createOrUpdateCustomer(name: string, email: string): Promise<SquareCustomer> {
  const client = initializeSquareClient();
  console.log('[Square] Creating/updating customer:', { name, email });

  try {
    // Search for existing customer
    const searchResponse = await client.customersApi.searchCustomers({
      query: {
        filter: {
          email: {
            exact: email
          }
        }
      }
    });

    if (searchResponse?.result?.customers?.[0]) {
      const customer = searchResponse.result.customers[0];
      console.log('[Square] Found existing customer:', customer.id);
      return {
        id: customer.id!,
        name: customer.givenName || name,
        email: customer.emailAddress!
      };
    }

    // Create new customer if not found
    const createResponse = await client.customersApi.createCustomer({
      idempotencyKey: `${Date.now()}-${email}`,
      givenName: name,
      emailAddress: email
    });

    if (!createResponse?.result?.customer?.id) {
      throw new Error('Failed to create customer');
    }

    const newCustomer = createResponse.result.customer;
    console.log('[Square] Created new customer:', newCustomer.id);

    return {
      id: newCustomer.id,
      name: newCustomer.givenName || name,
      email: newCustomer.emailAddress!
    };
  } catch (error) {
    console.error('[Square] Customer creation/update error:', error);
    throw error;
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
    throw error;
  }
}

export default {
  processPayment,
  createOrUpdateCustomer
};
