import square from 'square';
const { Client } = square;

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

let squareClient: Client | null = null;

async function initializeSquareClient() {
  if (!squareClient && process.env.SQUARE_ACCESS_TOKEN) {
    try {
      console.log('[Square Service] Initializing Square client...');
      squareClient = new Client({
        accessToken: process.env.SQUARE_ACCESS_TOKEN,
        environment: 'sandbox',
        userAgentDetail: 'bowling-league-app'
      });
      console.log('[Square Service] Square client initialized successfully');
    } catch (error) {
      console.error('[Square Service] Failed to initialize Square client:', error);
      throw error;
    }
  }
  return squareClient;
}

export async function createOrUpdateCustomer(name: string, email: string): Promise<SquareCustomer | null> {
  const client = await initializeSquareClient();
  if (!client) return null;

  try {
    const searchResponse = await client.customersApi.searchCustomers({
      query: {
        filter: {
          emailAddress: {
            exact: email.toLowerCase()
          }
        }
      }
    });

    let customerId;

    if (searchResponse.result.customers?.[0]?.id) {
      customerId = searchResponse.result.customers[0].id;
      await client.customersApi.updateCustomer(customerId, {
        givenName: name.split(' ')[0],
        familyName: name.split(' ').slice(1).join(' ') || '',
        emailAddress: email.toLowerCase(),
      });
    } else {
      const customerResponse = await client.customersApi.createCustomer({
        idempotencyKey: `${Date.now()}-${Math.random()}`,
        givenName: name.split(' ')[0],
        familyName: name.split(' ').slice(1).join(' ') || '',
        emailAddress: email.toLowerCase(),
      });

      if (!customerResponse.result?.customer?.id) {
        throw new Error('Failed to create Square customer');
      }

      customerId = customerResponse.result.customer.id;
    }

    return {
      id: customerId,
      name,
      email
    };
  } catch (error) {
    console.error('[Square Service] Customer operation error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

export async function processPayment(sourceId: string, amount: number, locationId: string) {
  const client = await initializeSquareClient();
  if (!client) {
    throw new Error("Square client not initialized");
  }

  try {
    const response = await client.paymentsApi.createPayment({
      sourceId,
      idempotencyKey: `${Date.now()}-${Math.random()}`,
      amountMoney: {
        amount: BigInt(amount),
        currency: 'USD'
      },
      locationId,
    });

    if (!response.result.payment) {
      throw new Error("Payment creation failed");
    }

    const payment = response.result.payment;
    return {
      id: payment.id,
      status: payment.status,
      card: {
        last4: payment.cardDetails?.card?.last4 ?? '****',
        brand: payment.cardDetails?.card?.cardBrand ?? 'UNKNOWN'
      }
    };
  } catch (error) {
    console.error('[Square Service] Payment processing error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

export default {
  createOrUpdateCustomer,
  processPayment
};