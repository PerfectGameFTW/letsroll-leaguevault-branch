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

// Get the application credentials
const appId = import.meta.env.VITE_SQUARE_APP_ID || '';
const locationId = import.meta.env.VITE_SQUARE_LOCATION_ID || '';

// Determine environment based on App ID format
// Production app IDs don't have 'sandbox-' prefix
const isProduction = !appId.includes('sandbox-');

// Additional debug information
console.log('[Square] Application ID:', appId ? (appId.substring(0, 5) + '...') : 'not set');
console.log('[Square] Location ID:', locationId ? (locationId.substring(0, 5) + '...') : 'not set');

// Always use production SDK for production credentials
const SQUARE_SDK_URL = isProduction
  ? "https://web.squarecdn.com/v1/square.js" // Production SDK
  : "https://sandbox.web.squarecdn.com/v1/square.js"; // Sandbox SDK

// Log environment details for debugging
console.log(`[Square] App ID detected as ${isProduction ? 'PRODUCTION' : 'SANDBOX'} format`);
console.log(`[Square] Using ${isProduction ? 'PRODUCTION' : 'SANDBOX'} SDK URL: ${SQUARE_SDK_URL}`);

export async function initializeSquare() {
  try {
    // Start fresh each time
    payments = null;
    initializationPromise = null;
    
    // Clear any previously loaded Square SDK
    if (window.Square) {
      console.log('[Square] Removing existing Square SDK to ensure clean environment');
      document.querySelectorAll('script[src*="square.js"]').forEach(script => script.remove());
      (window as any).Square = undefined;
    }

    // Create initialization with timeout protection
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Square initialization timed out after 10 seconds")), 10000);
    });
    
    // Initialization function
    const initializeFunction = async () => {
      console.log('[Square] Starting Square SDK initialization...');
      
      // First load the SDK
      console.log(`[Square] Loading Square SDK from ${isProduction ? 'production' : 'sandbox'} environment...`);
      await loadScript(SQUARE_SDK_URL);
      console.log('[Square] Square SDK loaded successfully');
      
      // Check if SDK is properly loaded
      if (!window.Square?.payments) {
        console.error('[Square] Square SDK not properly loaded');
        throw new Error("Square SDK failed to load properly");
      }
      
      // Initialize payments with credentials
      console.log('[Square] Initializing Square payments with credentials');
      payments = await window.Square.payments(appId, locationId);
      console.log('[Square] Square payments initialized successfully');
      return payments;
    };

    // Execute with timeout protection
    initializationPromise = Promise.race([
      initializeFunction(),
      timeoutPromise
    ]);
    
    return initializationPromise;
  } catch (error) {
    console.error('[Square] Critical error during Square initialization:', error);
    payments = null;
    initializationPromise = null;
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