import { Client, Environment } from 'square';

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

// Initialize Square client
let squareClient: Client | null = null;

function initializeSquareClient(): Client {
  if (!squareClient && process.env.SQUARE_ACCESS_TOKEN) {
    try {
      squareClient = new Client({
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

    if (error instanceof Error) {
      throw new Error(`Payment processing failed: ${error.message}`);
    } else {
      throw new Error('An unexpected error occurred during payment processing');
    }
  }
}

export async function createOrUpdateCustomer(name: string, email: string): Promise<SquareCustomer> {
  const client = initializeSquareClient();

  try {
    // Search for existing customer by email
    const searchResponse = await client.customersApi.searchCustomers({
      query: {
        filter: {
          emailAddress: {
            exact: email
          }
        }
      }
    });

    let customer;
    if (searchResponse.result.customers?.length) {
      // Update existing customer
      const existingCustomer = searchResponse.result.customers[0];
      const updateResponse = await client.customersApi.updateCustomer(existingCustomer.id!, {
        emailAddress: email,
        givenName: name
      });
      customer = updateResponse.result.customer;
    } else {
      // Create new customer
      const createResponse = await client.customersApi.createCustomer({
        idempotencyKey: `${Date.now()}-${Math.random()}`,
        emailAddress: email,
        givenName: name
      });
      customer = createResponse.result.customer;
    }

    if (!customer) {
      throw new Error("Failed to create or update customer");
    }

    return {
      id: customer.id!,
      name: customer.givenName ?? name,
      email: customer.emailAddress ?? email
    };
  } catch (error) {
    console.error('[Square] Customer operation failed:', error);
    throw error instanceof Error ? error : new Error('Failed to create or update customer');
  }
}

export default {
  processPayment,
  createOrUpdateCustomer
};