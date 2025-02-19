import { Client, Environment } from 'square';
import type { ApiError } from 'square';

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

      const environment = process.env.NODE_ENV === 'production' ? Environment.Production : Environment.Sandbox;
      squareClient = new Client({
        accessToken: process.env.SQUARE_ACCESS_TOKEN,
        environment
      });

      console.log('[Square Service] Square client initialized successfully');
      console.log('[Square Service] Using environment:', environment === Environment.Production ? 'Production' : 'Sandbox');
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

    if (!searchResponse?.result) {
      throw new Error('API Error: Invalid search response');
    }

    let customerId: string;
    const [firstName, ...lastNameParts] = name.split(' ');
    const lastName = lastNameParts.join(' ');

    if (searchResponse.result.customers?.[0]?.id) {
      console.log('[Square Service] Found existing customer, updating...');
      customerId = searchResponse.result.customers[0].id;
      const updateResponse = await client.customersApi.updateCustomer(customerId, {
        givenName: firstName,
        familyName: lastName || '',
        emailAddress: email.toLowerCase(),
      });

      if (!updateResponse?.result?.customer) {
        throw new Error('API Error: Invalid update response');
      }

      console.log('[Square Service] Customer updated successfully:', updateResponse.result.customer.id);
    } else {
      console.log('[Square Service] No existing customer found, creating new...');
      const customerResponse = await client.customersApi.createCustomer({
        idempotencyKey: `${Date.now()}-${Math.random()}`,
        givenName: firstName,
        familyName: lastName || '',
        emailAddress: email.toLowerCase(),
      });

      if (!customerResponse?.result?.customer?.id) {
        throw new Error('API Error: Invalid create response');
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
      mode: process.env.NODE_ENV === 'production' ? 'Production' : 'Sandbox'
    });

    // Validate inputs
    if (!sourceId || !amount || !locationId) {
      throw new Error('Missing required payment parameters');
    }

    // Ensure amount is a positive integer
    if (amount <= 0 || !Number.isInteger(amount)) {
      throw new Error('Invalid payment amount');
    }

    const response = await client.paymentsApi.createPayment({
      sourceId,
      idempotencyKey: `${Date.now()}-${Math.random()}`,
      amountMoney: {
        amount: BigInt(amount),
        currency: 'USD'
      },
      locationId,
      autocomplete: true
    });

    if (!response?.result?.payment) {
      throw new Error('Invalid payment response from Square API');
    }

    const payment = response.result.payment;
    console.log('[Square Service] Payment processed successfully:', {
      paymentId: payment.id,
      status: payment.status,
      cardLast4: payment.cardDetails?.card?.last4 ?? '****',
      cardBrand: payment.cardDetails?.card?.cardBrand ?? 'UNKNOWN',
      amount: payment.amountMoney?.amount?.toString()
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
    // Enhanced error logging with proper type checking
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

    // Handle Square API specific errors
    if ((error as ApiError)?.statusCode === 400) {
      const squareError = error as ApiError;
      const details = squareError.result?.errors?.[0]?.detail || 'Invalid request parameters';
      throw new Error(`Square API Error: ${details}`);
    }

    if ((error as ApiError)?.statusCode === 401) {
      throw new Error('Square API Error: Invalid credentials');
    }

    if ((error as ApiError)?.statusCode === 402) {
      throw new Error('Square API Error: Payment required');
    }

    throw new Error('Failed to process Square payment: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export default {
  createOrUpdateCustomer,
  processPayment
};