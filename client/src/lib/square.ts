import { loadScript } from "@/lib/utils";

interface PaymentResult {
  id: string;
  status: string;
  card?: {
    last4: string;
    brand: string;
  };
  cardOnFile?: {
    id: string;
    last4: string;
    brand: string;
  };
}

interface SquareCustomer {
  id: string;
  name: string;
  email: string;
}

declare global {
  interface Window {
    Square: {
      payments: (appId: string, locationId: string) => Promise<any>;
    };
  }
}

let payments: any = null;
let initializationPromise: Promise<any> | null = null;

// Note: Square updated their CDN pattern for production and sandbox SDKs
const SQUARE_SDK_URL = import.meta.env.MODE === 'production'
  ? "https://web.squarecdn.com/v1/square.js"
  : "https://sandbox.web.squarecdn.com/v1/square.js";

export async function initializeSquare() {
  try {
    // Check if we already have a successfully initialized payments instance
    if (payments) {
      console.log('[Square] Using existing payments instance');
      return payments;
    }
    
    // If there's an existing initialization in progress, return that promise
    if (initializationPromise) {
      console.log('[Square] Using existing initialization promise');
      return initializationPromise;
    }

    // Create new initialization promise with timeout protection
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Square initialization timed out after 10 seconds"));
      }, 10000);
    });
    
    // Main initialization function
    const initializeFunction = async () => {
      try {
        console.log('[Square] Starting Square SDK initialization...');

        // Validate environment variables
        console.log('[Square] Checking environment variables:');
        const appId = import.meta.env.VITE_SQUARE_APP_ID;
        const locationId = import.meta.env.VITE_SQUARE_LOCATION_ID;
        
        console.log('[Square] VITE_SQUARE_APP_ID:', appId ? 'Available' : 'Missing');
        console.log('[Square] VITE_SQUARE_LOCATION_ID:', locationId ? 'Available' : 'Missing');
        
        if (!appId || !locationId) {
          const missing = [];
          if (!appId) missing.push('VITE_SQUARE_APP_ID');
          if (!locationId) missing.push('VITE_SQUARE_LOCATION_ID');
          
          console.error('[Square] Missing required Square credentials:', missing.join(', '));
          throw new Error(`Square credentials are not properly configured. Missing: ${missing.join(', ')}`);
        }

        // Check if Square SDK is already loaded
        if (!window.Square) {
          console.log('[Square] Loading Square SDK from sandbox CDN...');
          try {
            await loadScript(SQUARE_SDK_URL);
            console.log('[Square] Square SDK loaded successfully');
          } catch (error) {
            console.error('[Square] Failed to load Square SDK:', error);
            throw new Error("Failed to load Square SDK: " + (error instanceof Error ? error.message : String(error)));
          }
        } else {
          console.log('[Square] Square SDK already loaded');
        }

        // Verify Square SDK is available
        if (!window.Square || !window.Square.payments) {
          console.error('[Square] Square SDK not properly loaded - Square.payments is not available');
          throw new Error("Square SDK not properly loaded");
        }

        console.log('[Square] Initializing Square payments with provided credentials');
        try {
          payments = await window.Square.payments(appId, locationId);
          console.log('[Square] Square payments initialized successfully');
          return payments;
        } catch (error) {
          console.error('[Square] Failed to initialize Square payments:', error);
          throw new Error("Failed to initialize Square payments: " + (error instanceof Error ? error.message : String(error)));
        }
      } catch (error) {
        console.error('[Square] Error during initialization:', error);
        // Reset shared state to allow future retry attempts
        payments = null;
        initializationPromise = null;
        throw error;
      }
    };

    // Create the initialization promise with timeout protection
    initializationPromise = Promise.race([
      initializeFunction(),
      timeoutPromise
    ]);

    // Return the promise
    return initializationPromise;
  } catch (error) {
    console.error('[Square] Critical error during Square initialization:', error);
    // Reset for retry
    initializationPromise = null;
    payments = null;
    throw error;
  }
}

export async function createPayment(amount: number, cardInstance: any, bowlerId: number, leagueId: number, storeCard: boolean = false): Promise<PaymentResult> {
  try {
    if (!cardInstance) {
      console.error('[Square] Card form not initialized');
      throw new Error(JSON.stringify({
        error: {
          message: "Please complete the card details before proceeding",
          code: "INITIALIZATION_ERROR"
        }
      }));
    }

    // Ensure amount is a positive integer
    if (amount <= 0 || !Number.isInteger(amount)) {
      console.error('[Square] Invalid payment amount:', amount);
      throw new Error(JSON.stringify({
        error: {
          message: "Invalid payment amount. Please enter a valid amount.",
          code: "INVALID_AMOUNT"
        }
      }));
    }

    console.log('[Square] Starting payment process for amount:', amount);
    console.log('[Square] Tokenizing card...');

    // If storeCard is true, request a card-on-file token
    const tokenizationOptions = storeCard ? {
      cardOnFile: true,
      verificationMethod: 'EXTERNAL',
      verificationDetails: {
        amount: amount.toString(),
        currencyCode: 'USD',
        intent: 'STORE',
        billingContact: {
          familyName: 'Customer',
          givenName: 'Store',
          email: 'customer@example.com',
          country: 'US',
          city: 'City',
          addressLines: ['Address Line 1'],
          postalCode: '12345'
        },
        customerInitiated: true,
        sellerKeyedIn: false
      }
    } : {
      verificationDetails: {
        billingContact: {
          familyName: 'Customer',
          givenName: 'Store',
          email: 'customer@example.com',
          country: 'US',
          city: 'City',
          addressLines: ['Address Line 1'],
          postalCode: '12345'
        },
        intent: 'CHARGE',
        customerInitiated: true,
        sellerKeyedIn: false
      }
    };

    const result = await cardInstance.tokenize(tokenizationOptions);
    console.log('[Square] Tokenization result:', {
      status: result.status,
      hasErrors: !!result.errors,
      token: result.token ? 'present' : 'missing',
      isCardOnFile: storeCard
    });

    if (result.status === 'OK' && result.token) {
      console.log('[Square] Card tokenized successfully, sending to server...');

      const paymentData = {
        sourceId: result.token,
        amount,
        bowlerId,
        leagueId,
        storeCard
      };

      console.log('[Square] Payment request data:', {
        ...paymentData,
        sourceId: 'hidden-for-security'
      });

      const response = await fetch('/api/square/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData),
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error('[Square] Server payment error:', responseData);
        const errorMessage = responseData.error?.message || 'Payment processing failed';
        throw new Error(JSON.stringify({
          error: {
            message: errorMessage.replace(/Square API Error:/i, 'Payment Error:'),
            code: responseData.error?.code || "PAYMENT_FAILED"
          }
        }));
      }

      console.log('[Square] Server response:', {
        status: response.status,
        ok: response.ok,
        data: responseData
      });

      if (!responseData.status || responseData.status !== 'COMPLETED') {
        console.error('[Square] Payment not completed:', responseData);
        throw new Error(JSON.stringify({
          error: {
            message: "We couldn't complete your payment. Please try again.",
            code: "PAYMENT_INCOMPLETE"
          }
        }));
      }

      console.log('[Square] Payment processed successfully:', {
        paymentId: responseData.id,
        status: responseData.status,
        cardLast4: responseData.card?.last4,
        cardBrand: responseData.card?.brand,
        cardOnFile: responseData.cardOnFile
      });

      return responseData;
    } else {
      const errors = result.errors || [];
      const errorMessage = errors.map((e: any) => e.message).join(', ') || 'Card validation failed';
      console.error('[Square] Card tokenization failed:', {
        errors,
        firstError: errorMessage
      });
      throw new Error(JSON.stringify({
        error: {
          message: "Please check your card details and try again.",
          code: "TOKENIZATION_ERROR"
        }
      }));
    }
  } catch (error) {
    console.error('[Square] Payment error:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      amount
    });

    // If the error is already JSON formatted, parse and reformat it
    if (error instanceof Error && error.message.startsWith('{')) {
      try {
        const parsedError = JSON.parse(error.message);
        // Make the error message more user-friendly
        if (parsedError.error?.message) {
          parsedError.error.message = parsedError.error.message
            .replace(/Square API Error:/i, 'Payment Error:')
            .replace(/location_id=/i, 'location ')
            .replace(/\bLY5C3TE48WEXX\b/, 'configuration');
        }
        throw new Error(JSON.stringify(parsedError));
      } catch {
        // If JSON parsing fails, throw the original error
        throw error;
      }
    }

    // Otherwise, wrap it in our error format
    throw new Error(JSON.stringify({
      error: {
        message: 'Unable to process payment. Please try again later.',
        code: "PAYMENT_FAILED"
      }
    }));
  }
}

export async function createSquareCustomer(name: string, email: string, teamId: number): Promise<SquareCustomer> {
  try {
    console.log('[Square] Creating customer:', { name, email, teamId });
    const response = await fetch('/api/square/customers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, email, teamId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Square] Failed to create customer:', errorText);
      throw new Error(errorText || 'Failed to create Square customer');
    }

    const customer = await response.json();
    console.log('[Square] Customer created successfully:', {
      customerId: customer.id,
      name: customer.name
    });

    return customer;
  } catch (error) {
    console.error('[Square] Error creating customer:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      input: { name, email, teamId }
    });
    throw new Error('Failed to create Square customer: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export function getSquareCustomerUrl(customerId: string): string {
  return `https://squareup.com/dashboard/customers/${customerId}`;
}

export async function enrollInLoyalty(customerId: string) {
  try {
    console.log('[Square] Enrolling customer in loyalty program:', customerId);
    const response = await fetch('/api/square/loyalty/enroll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customerId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Square] Failed to enroll in loyalty program:', errorText);
      throw new Error(errorText || 'Failed to enroll in loyalty program');
    }

    const result = await response.json();
    console.log('[Square] Successfully enrolled in loyalty program:', result);
    return result;
  } catch (error) {
    console.error('[Square] Error enrolling in loyalty program:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      customerId
    });
    throw new Error('Failed to enroll in loyalty program: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export async function getLoyaltyPoints(customerId: string) {
  try {
    console.log('[Square] Fetching loyalty points for customer:', customerId);
    const response = await fetch(`/api/square/loyalty/points/${customerId}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Square] Failed to get loyalty points:', errorText);
      throw new Error(errorText || 'Failed to get loyalty points');
    }

    const result = await response.json();
    console.log('[Square] Successfully retrieved loyalty points:', result);
    return result;
  } catch (error) {
    console.error('[Square] Error getting loyalty points:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      customerId
    });
    throw new Error('Failed to get loyalty points: ' + (error instanceof Error ? error.message : String(error)));
  }
}