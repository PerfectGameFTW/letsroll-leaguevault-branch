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

export async function processPayment(sourceId: string, amount: number, storeCard: boolean = false) {
  const client = await initializeSquareClient();
  if (!client) {
    throw new Error(JSON.stringify({
      error: {
        message: "Payment system is temporarily unavailable",
        code: "INITIALIZATION_ERROR"
      }
    }));
  }

  try {
    console.log('[Square Service] Processing payment:', { 
      amount,
      sourceIdPrefix: sourceId.substring(0, 5),
      mode: process.env.NODE_ENV === 'production' ? 'Production' : 'Sandbox',
      storeCard
    });

    // Validate inputs
    if (!sourceId || !amount) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Missing required payment information',
          code: "INVALID_REQUEST"
        }
      }));
    }

    // Ensure amount is a positive integer
    if (amount <= 0 || !Number.isInteger(amount)) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Invalid payment amount',
          code: "INVALID_AMOUNT"
        }
      }));
    }

    const paymentRequest = {
      sourceId,
      idempotencyKey: `${Date.now()}-${Math.random()}`,
      amountMoney: {
        amount: BigInt(amount),
        currency: 'USD'
      },
      autocomplete: true
    };

    // If storing card is requested, add the card_on_file parameter
    if (storeCard) {
      paymentRequest.card_on_file = true;
    }

    const response = await client.paymentsApi.createPayment(paymentRequest);

    if (!response?.result?.payment) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Unable to process payment',
          code: "INVALID_RESPONSE"
        }
      }));
    }

    const payment = response.result.payment;
    const cardDetails = payment.cardDetails?.card;

    // If storing card was requested, get the card on file details
    let cardOnFile;
    if (storeCard && payment.cardDetails?.status === 'CAPTURED') {
      try {
        const cardResponse = await client.cardsApi.retrieveCard(payment.cardDetails.card?.id || '');
        if (cardResponse?.result?.card) {
          cardOnFile = {
            id: cardResponse.result.card.id,
            last4: cardResponse.result.card.last4,
            brand: cardResponse.result.card.cardBrand
          };
        }
      } catch (error) {
        console.error('[Square Service] Error retrieving stored card:', error);
      }
    }

    console.log('[Square Service] Payment processed successfully:', {
      paymentId: payment.id,
      status: payment.status,
      cardLast4: cardDetails?.last4 ?? '****',
      cardBrand: cardDetails?.cardBrand ?? 'UNKNOWN',
      amount: payment.amountMoney?.amount?.toString(),
      cardOnFile: cardOnFile ? {
        id: `${cardOnFile.id.substring(0, 10)}...`,
        last4: cardOnFile.last4,
        brand: cardOnFile.brand
      } : 'not-created'
    });

    return {
      id: payment.id,
      status: payment.status,
      card: {
        last4: cardDetails?.last4 ?? '****',
        brand: cardDetails?.cardBrand ?? 'UNKNOWN'
      },
      cardOnFile
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
        sourceIdPresent: !!sourceId,
        storeCard
      }
    });

    // Handle Square API specific errors
    if ((error as ApiError)?.statusCode === 400) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Invalid payment information. Please check your card details.',
          code: "INVALID_REQUEST"
        }
      }));
    }

    if ((error as ApiError)?.statusCode === 401) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Payment system is temporarily unavailable. Please try again later.',
          code: "SYSTEM_ERROR"
        }
      }));
    }

    if ((error as ApiError)?.statusCode === 402) {
      throw new Error(JSON.stringify({
        error: {
          message: 'Your payment was declined. Please try a different card.',
          code: "PAYMENT_DECLINED"
        }
      }));
    }

    // For all other errors, return a user-friendly message
    throw new Error(JSON.stringify({
      error: {
        message: 'Unable to process your payment. Please try again later.',
        code: "PAYMENT_FAILED"
      }
    }));
  }
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

export default {
  createOrUpdateCustomer,
  processPayment
};