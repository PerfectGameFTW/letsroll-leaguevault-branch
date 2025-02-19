import { Client, Environment } from 'square';

// Initialize Square client with enhanced error handling and logging
let squareClient: typeof Client | null = null;

async function initializeSquareClient(): Promise<typeof Client> {
  try {
    // Return existing client if already initialized and valid
    if (squareClient) {
      try {
        // Test existing client
        await squareClient.locationsApi.listLocations();
        return squareClient;
      } catch (error) {
        console.log('[Square Service] Existing client invalid, reinitializing...');
        squareClient = null;
      }
    }

    // Validate required credentials
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    if (!accessToken) {
      console.error('[Square Service] Missing SQUARE_ACCESS_TOKEN environment variable');
      throw new Error('Square access token not configured');
    }

    console.log('[Square Service] Initializing Square client...');
    squareClient = new Client({
      accessToken,
      environment: Environment.Sandbox,
      userAgentDetail: 'bowling-league-app',
      timeout: 30000,
    });

    // Test connection by making a simple API call
    try {
      console.log('[Square Service] Testing Square client connection...');
      const { result } = await squareClient.locationsApi.listLocations();
      if (!result?.locations?.length) {
        throw new Error('No locations found for the provided credentials');
      }
      console.log('[Square Service] Square client connection test successful');
    } catch (error) {
      console.error('[Square Service] Connection test failed:', error);
      squareClient = null;
      throw new Error('Failed to validate Square client connection');
    }

    return squareClient;
  } catch (error) {
    console.error('[Square Service] Square client initialization failed:', error);
    squareClient = null; // Reset client on failure

    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to initialize Square client');
  }
}

export async function processPayment(sourceId: string, amount: number, locationId: string): Promise<{
  id: string;
  status: string;
  card: {
    last4: string;
    brand: string;
  };
}> {
  if (!sourceId || !amount || !locationId) {
    throw new Error('Missing required payment parameters');
  }
  try {
    const client = await initializeSquareClient();
    console.log('[Square Service] Processing payment:', { amount, locationId });

    const response = await client.paymentsApi.createPayment({
      sourceId,
      idempotencyKey: `payment_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      amountMoney: {
        amount: BigInt(amount),
        currency: 'USD'
      },
      locationId,
    });

    if (!response?.result?.payment) {
      throw new Error('Payment creation failed - no payment details returned');
    }

    const payment = response.result.payment;
    console.log('[Square Service] Payment processed successfully:', {
      id: payment.id,
      status: payment.status,
      cardLast4: payment.cardDetails?.card?.last4
    });

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
    // Log the full error context
    console.error('[Square Service] Error context:', {
      error,
      type: typeof error,
      keys: error ? Object.keys(error) : [],
      stack: error?.stack,
      name: error?.name
    });

    if (!error) {
      throw new Error('Payment processing failed - no error details available');
    }

    if (error instanceof Error) {
      throw error;
    }

    if (typeof error === 'object') {
      const squareError = error as any;
      const errorMessage = 
        squareError.message || 
        squareError.details?.[0]?.message ||
        squareError.errors?.[0]?.detail ||
        squareError.errors?.[0]?.message ||
        squareError.result?.errors?.[0]?.detail;

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (squareError.statusCode) {
        throw new Error(`Square API error (${squareError.statusCode})`);
      }

      // If we have any error data at all, stringify and return it
      if (Object.keys(squareError).length > 0) {
        throw new Error(`Square API error: ${JSON.stringify(squareError)}`);
      }
    }
    
    throw new Error('Payment processing failed - unknown error');
  }
}

export async function createOrUpdateCustomer(name: string, email: string): Promise<{
  id: string;
  name: string;
  email: string;
} | null> {
  try {
    const client = await initializeSquareClient();
    console.log('[Square Service] Creating customer:', { name, email });

    const response = await client.customersApi.createCustomer({
      idempotencyKey: `customer_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      givenName: name,
      emailAddress: email,
    });

    if (!response?.result?.customer) {
      throw new Error('Customer creation failed - no customer details returned');
    }

    const customer = response.result.customer;
    console.log('[Square Service] Customer created:', { 
      id: customer.id,
      name: customer.givenName,
      email: customer.emailAddress 
    });

    return {
      id: customer.id,
      name: customer.givenName ?? name,
      email: customer.emailAddress ?? email
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