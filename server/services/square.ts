const { Client } = require('square');
import type { ApiError } from 'square';
import type { Environment } from 'square';

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

// Initialize Square client
let squareClient: Client | null = null;

async function initializeSquareClient(): Promise<Client> {
  if (!squareClient && process.env.SQUARE_ACCESS_TOKEN) {
    try {
      console.log('[Square Service] Initializing client...');
      squareClient = new Client({
        accessToken: process.env.SQUARE_ACCESS_TOKEN,
        environment: Environment.Sandbox // Use Environment.Production for production
      });
      console.log('[Square Service] Client initialized successfully');
    } catch (error) {
      console.error('[Square Service] Failed to initialize client:', error);
      throw new Error('Failed to initialize Square client');
    }
  }

  if (!squareClient) {
    throw new Error("Square access token not configured");
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
  try {
    const client = await initializeSquareClient();
    console.log('[Square Service] Processing payment:', { amount, locationId });

    const response = await client.paymentsApi.createPayment({
      sourceId,
      idempotencyKey: `${Date.now()}-${Math.random()}`,
      amountMoney: {
        amount: BigInt(amount),
        currency: 'USD'
      },
      locationId,
    });

    if (!response.result?.payment) {
      throw new Error("Payment creation failed");
    }

    const payment = response.result.payment;
    console.log('[Square Service] Payment processed successfully:', payment.id);

    return {
      id: payment.id ?? '',
      status: payment.status ?? 'UNKNOWN',
      card: {
        last4: payment.cardDetails?.card?.last4 ?? '****',
        brand: payment.cardDetails?.card?.cardBrand ?? 'UNKNOWN'
      }
    };
  } catch (error) {
    console.error('[Square Service] Payment processing error:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while processing payment');
  }
}

export async function createOrUpdateCustomer(name: string, email: string): Promise<SquareCustomer | null> {
  try {
    const client = await initializeSquareClient();
    const response = await client.customersApi.createCustomer({
      idempotencyKey: `${Date.now()}-${Math.random()}`,
      givenName: name,
      emailAddress: email,
    });
    console.log("Customer created", response)
    return {
      id: response.result.customer.id,
      name: response.result.customer.givenName,
      email: response.result.customer.emailAddress
    };
  } catch (error) {
    console.error('[Square Service] Customer creation error:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('An unexpected error occurred while creating customer');
  }
}

export default {
  processPayment,
  createOrUpdateCustomer
};