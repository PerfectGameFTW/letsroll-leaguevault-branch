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
let squareConfig: { appId: string; locationId: string } | null = null;
let preWarmedCard: any = null;

const cardStyle = {
  input: {
    backgroundColor: '#FFFFFF',
    fontSize: '14px',
    color: '#333333',
  },
  'input.is-focus': {
    backgroundColor: '#FAFAFA',
  },
  '.input-container': {
    borderColor: '#DDDDDD',
  },
  '.input-container.is-focus': {
    borderColor: '#888888',
  },
  '.input-container.is-error': {
    borderColor: '#CC0023',
  },
};

export async function warmUpSquareCard(): Promise<void> {
  try {
    if (!payments) return;
    if (preWarmedCard) return;
    preWarmedCard = await payments.card({ style: cardStyle });
    console.log('[Square] Card object pre-warmed successfully');
  } catch (err) {
    console.error('[Square] Failed to pre-warm card:', err);
    preWarmedCard = null;
  }
}

export function getPreWarmedCard(): any {
  const card = preWarmedCard;
  preWarmedCard = null;
  return card;
}

export { cardStyle };

export function resetSquarePayments() {
  payments = null;
}

async function getSquareConfig(): Promise<{ appId: string; locationId: string }> {
  if (squareConfig) return squareConfig;

  try {
    const res = await fetch('/api/square/config');
    const data = await res.json();
    if (data.appId) {
      squareConfig = { appId: data.appId, locationId: data.locationId || '' };
      console.log('[Square] Using runtime config from server, isProduction:', !data.appId.includes('sandbox-'));
      return squareConfig;
    }
  } catch (err) {
    console.error('[Square] Failed to fetch config from server:', err);
  }

  const buildTimeAppId = import.meta.env.VITE_SQUARE_APP_ID || '';
  const buildTimeLocationId = import.meta.env.VITE_SQUARE_LOCATION_ID || '';
  squareConfig = { appId: buildTimeAppId, locationId: buildTimeLocationId };
  console.log('[Square] Using build-time config, isProduction:', buildTimeAppId.length > 0 && !buildTimeAppId.includes('sandbox-'));
  return squareConfig;
}

function getSdkUrl(appId: string): string {
  const isProduction = appId.length > 0 && !appId.includes('sandbox-');
  return isProduction
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";
}

export async function initializeSquare() {
  try {
    if (payments && window.Square?.payments) {
      return payments;
    }

    payments = null;

    const config = await getSquareConfig();
    const sdkUrl = getSdkUrl(config.appId);
    const isProduction = config.appId.length > 0 && !config.appId.includes('sandbox-');

    console.log('[Square] SDK config:', { appIdSet: config.appId.length > 0, isProduction, sdkUrl });

    if (window.Square && !window.Square.payments) {
      document.querySelectorAll('script[src*="square.js"]').forEach(script => script.remove());
      (window as any).Square = undefined;
    }

    const existingSdkScript = document.querySelector('script[src*="square"]') as HTMLScriptElement | null;
    if (existingSdkScript && existingSdkScript.src !== sdkUrl) {
      existingSdkScript.remove();
      (window as any).Square = undefined;
    }

    if (window.Square?.payments) {
      try {
        payments = await window.Square.payments(config.appId, config.locationId);
        return payments;
      } catch (initError) {
        console.error('[Square] Failed to initialize with existing SDK, will reload:', initError);
        document.querySelectorAll('script[src*="square.js"]').forEach(script => script.remove());
        (window as any).Square = undefined;
      }
    }

    const timeoutMs = isProduction ? 15000 : 10000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Square initialization timed out after ${timeoutMs/1000} seconds`)), timeoutMs);
    });

    const initializeFunction = async () => {
      let scriptLoaded = false;
      let attempts = 0;
      let lastError;

      while (!scriptLoaded && attempts < 3) {
        attempts++;
        try {
          await loadScript(sdkUrl);
          scriptLoaded = true;
        } catch (err) {
          lastError = err;
          console.error(`[Square] Failed to load SDK on attempt ${attempts}/3:`, err);
          if (attempts < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      if (!scriptLoaded) {
        throw lastError || new Error("Failed to load Square SDK after multiple attempts");
      }

      if (!window.Square?.payments) {
        throw new Error("Square SDK failed to initialize properly");
      }

      try {
        payments = await window.Square.payments(config.appId, config.locationId);
        return payments;
      } catch (initError) {
        console.error('[Square] Failed to initialize payments with credentials:', initError);
        const errorMessage = initError instanceof Error ? initError.message : String(initError);
        if (errorMessage.includes('location_id') || errorMessage.includes('invalid location')) {
          throw new Error(`Square location ID issue: ${errorMessage}`);
        } else if (errorMessage.includes('application_id') || errorMessage.includes('app_id')) {
          throw new Error(`Square application ID issue: ${errorMessage}`);
        } else if (errorMessage.includes('unauthorized') || errorMessage.includes('not authorized')) {
          throw new Error(`Square authorization issue: ${errorMessage}`);
        }
        throw initError;
      }
    };

    let attemptCount = 0;
    const maxRetries = 2;

    while (attemptCount <= maxRetries) {
      try {
        const result = await Promise.race([
          initializeFunction(),
          timeoutPromise
        ]);
        return result;
      } catch (error) {
        attemptCount++;
        if (attemptCount <= maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          console.error('[Square] All initialization attempts failed');
          throw error;
        }
      }
    }

    throw new Error("Square initialization failed after multiple attempts");
  } catch (error) {
    console.error('[Square] Critical error during Square initialization:', error);
    payments = null;
    throw error;
  }
}

export async function createPayment(amount: number, cardInstance: any, bowlerId: number, leagueId: number, storeCard: boolean = false): Promise<PaymentResult> {
  try {
    if (!cardInstance) {
      throw new Error(JSON.stringify({
        error: {
          message: "Please complete the card details before proceeding",
          code: "INITIALIZATION_ERROR"
        }
      }));
    }

    if (amount <= 0 || !Number.isInteger(amount)) {
      throw new Error(JSON.stringify({
        error: {
          message: "Invalid payment amount. Please enter a valid amount.",
          code: "INVALID_AMOUNT"
        }
      }));
    }

    let result;

    try {
      result = await cardInstance.tokenize();
    } catch (tokenError) {
      try {
        result = await cardInstance.tokenize({
          verificationDetails: {
            amount: amount.toString(),
            currencyCode: 'USD',
            intent: 'CHARGE',
            billingContact: {
              familyName: 'Bowler',
              givenName: 'League',
              email: 'bowler@example.com',
              country: 'US',
              city: 'City',
              addressLines: ['Address Line 1'],
              postalCode: '12345'
            },
            customerInitiated: true,
            sellerKeyedIn: false
          }
        });
      } catch (secondTokenError) {
        if (storeCard) {
          try {
            result = await cardInstance.tokenize({ cardOnFile: true });
          } catch (finalError) {
            throw finalError;
          }
        } else {
          throw secondTokenError;
        }
      }
    }

    if (result.status === 'OK' && result.token) {
      const paymentData = {
        sourceId: result.token,
        amount,
        bowlerId,
        leagueId,
        storeCard
      };

      const response = await fetch('/api/square/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData),
      });

      const responseData = await response.json();

      if (!response.ok) {
        const errorMessage = responseData.error?.message || 'Payment processing failed';
        throw new Error(JSON.stringify({
          error: {
            message: errorMessage.replace(/Square API Error:/i, 'Payment Error:'),
            code: responseData.error?.code || "PAYMENT_FAILED"
          }
        }));
      }

      if (!responseData.status || responseData.status !== 'COMPLETED') {
        throw new Error(JSON.stringify({
          error: {
            message: "We couldn't complete your payment. Please try again.",
            code: "PAYMENT_INCOMPLETE"
          }
        }));
      }

      return responseData;
    } else {
      const errors = result.errors || [];
      const errorMessage = errors.map((e: any) => e.message).join(', ') || 'Card validation failed';
      throw new Error(JSON.stringify({
        error: {
          message: "Please check your card details and try again.",
          code: "TOKENIZATION_ERROR"
        }
      }));
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('{')) {
      try {
        const parsedError = JSON.parse(error.message);
        if (parsedError.error?.message) {
          parsedError.error.message = parsedError.error.message
            .replace(/Square API Error:/i, 'Payment Error:')
            .replace(/location_id=/i, 'location ')
            .replace(/\bLY5C3TE48WEXX\b/, 'configuration');
        }
        throw new Error(JSON.stringify(parsedError));
      } catch {
        throw error;
      }
    }

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
    const response = await fetch('/api/square/customers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, email, teamId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Failed to create Square customer');
    }

    const customer = await response.json();
    return customer;
  } catch (error) {
    throw new Error('Failed to create Square customer: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export function getSquareCustomerUrl(customerId: string): string {
  return `https://squareup.com/dashboard/customers/${customerId}`;
}

export async function enrollInLoyalty(customerId: string) {
  try {
    const response = await fetch('/api/square/loyalty/enroll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customerId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Failed to enroll in loyalty program');
    }

    const result = await response.json();
    return result;
  } catch (error) {
    throw new Error('Failed to enroll in loyalty program: ' + (error instanceof Error ? error.message : String(error)));
  }
}

export async function getLoyaltyPoints(customerId: string) {
  try {
    const response = await fetch(`/api/square/loyalty/points/${customerId}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Failed to get loyalty points');
    }

    const result = await response.json();
    return result;
  } catch (error) {
    throw new Error('Failed to get loyalty points: ' + (error instanceof Error ? error.message : String(error)));
  }
}
