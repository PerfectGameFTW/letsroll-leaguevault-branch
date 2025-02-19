import { Client, Environment } from 'square';

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
      console.log('[Square Service] Environment:', process.env.NODE_ENV);

      if (!process.env.SQUARE_ACCESS_TOKEN) {
        throw new Error('Square access token is not configured');
      }

      squareClient = new Client({
        accessToken: process.env.SQUARE_ACCESS_TOKEN,
        environment: process.env.NODE_ENV === 'production' ? Environment.Production : Environment.Sandbox
      });

      console.log('[Square Service] Square client initialized successfully');
      console.log('[Square Service] Using environment:', process.env.NODE_ENV === 'production' ? 'Production' : 'Sandbox');
    } catch (error) {
      console.error('[Square Service] Failed to initialize Square client:', error);
      throw new Error('Failed to initialize Square client: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  return squareClient;
}

export async function createOrUpdateCustomer(name: string, email: string): Promise<SquareCustomer | null> {
  const client = await initializeSquareClient();
  if (!client) {
    console.error('[Square Service] Square client not initialized');
    return null;
  }

  try {
    console.log('[Square Service] Searching for customer with email:', email);
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
      console.log('[Square Service] Found existing customer, updating...');
      customerId = searchResponse.result.customers[0].id;
      const updateResponse = await client.customersApi.updateCustomer(customerId, {
        givenName: name.split(' ')[0],
        familyName: name.split(' ').slice(1).join(' ') || '',
        emailAddress: email.toLowerCase(),
      });
      console.log('[Square Service] Customer updated successfully:', updateResponse.result.customer?.id);
    } else {
      console.log('[Square Service] No existing customer found, creating new...');
      const customerResponse = await client.customersApi.createCustomer({
        idempotencyKey: `${Date.now()}-${Math.random()}`,
        givenName: name.split(' ')[0],
        familyName: name.split(' ').slice(1).join(' ') || '',
        emailAddress: email.toLowerCase(),
      });

      if (!customerResponse.result?.customer?.id) {
        throw new Error('Failed to create Square customer: No customer ID returned');
      }

      customerId = customerResponse.result.customer.id;
      console.log('[Square Service] New customer created successfully:', customerId);
    }

    return {
      id: customerId,
      name,
      email
    };
  } catch (error) {
    console.error('[Square Service] Customer operation error:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      input: { name, email }
    });
    throw new Error('Failed to create/update Square customer: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export async function processPayment(sourceId: string, amount: number, locationId: string) {
  const client = await initializeSquareClient();
  if (!client) {
    throw new Error("Square client not initialized");
  }

  try {
    console.log('[Square Service] Processing payment:', { 
      amount, 
      locationId,
      sourceIdLength: sourceId.length,
      environment: client.environment
    });

    const response = await client.paymentsApi.createPayment({
      sourceId,
      idempotencyKey: `${Date.now()}-${Math.random()}`,
      amountMoney: {
        amount: BigInt(amount * 100), // Fixed: Multiply by 100 for cents
        currency: 'USD'
      },
      locationId,
    });

    if (!response.result.payment) {
      throw new Error("Payment creation failed: No payment object returned");
    }

    const payment = response.result.payment;
    console.log('[Square Service] Payment processed successfully:', {
      paymentId: payment.id,
      status: payment.status,
      cardLast4: payment.cardDetails?.card?.last4 ?? '****',
      cardBrand: payment.cardDetails?.card?.cardBrand ?? 'UNKNOWN'
    });

    return {
      id: payment.id,
      status: payment.status,
      card: {
        last4: payment.cardDetails?.card?.last4 ?? '****',
        brand: payment.cardDetails?.card?.cardBrand ?? 'UNKNOWN'
      }
    };
  } catch (error) {
    console.error('[Square Service] Payment processing error:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      input: { 
        amount,
        locationId,
        sourceIdPresent: !!sourceId
      }
    });
    throw new Error('Failed to process Square payment: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export default {
  createOrUpdateCustomer,
  processPayment
};