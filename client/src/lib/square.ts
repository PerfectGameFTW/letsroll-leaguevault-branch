import { loadScript } from "@/lib/utils";
import { csrfFetch } from '@/lib/queryClient';

const SDK_LOAD_MAX_ATTEMPTS = 3;
const SDK_LOAD_RETRY_DELAY_MS = 1000;
const INIT_MAX_RETRIES = 2;
const INIT_RETRY_DELAY_MS = 2000;

interface PaymentResult {
  id: string;
  status: string;
  savedCardId?: string | null;
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

export interface SquarePaymentRequestDetails {
  countryCode: string;
  currencyCode: string;
  total: { amount: string; label: string };
}

export interface SquarePaymentRequest {
  update(details: { total: { amount: string; label: string } }): void;
}

export interface SquareWalletPayment {
  attach(selectorOrElement: string | HTMLElement): Promise<void>;
  tokenize(): Promise<TokenizeResult>;
  destroy(): void;
}

interface SquarePayments {
  card(options?: { style?: Record<string, Record<string, string>> }): Promise<SquareCard>;
  paymentRequest(details: SquarePaymentRequestDetails): SquarePaymentRequest;
  applePay(paymentRequest: SquarePaymentRequest): Promise<SquareWalletPayment>;
  googlePay(paymentRequest: SquarePaymentRequest): Promise<SquareWalletPayment>;
}

interface SquareCard {
  attach(selectorOrElement: string | HTMLElement): Promise<void>;
  tokenize(options?: Record<string, unknown>): Promise<TokenizeResult>;
  destroy(): void;
}

interface TokenizeResult {
  status: string;
  token?: string;
  errors?: Array<{ message: string }>;
}

interface SquareConfigResponse {
  appId: string;
  locationId?: string;
}

declare global {
  interface Window {
    Square?: {
      payments?: (appId: string, locationId: string) => Promise<SquarePayments>;
    };
  }
}

let payments: SquarePayments | null = null;
let squareConfig: { appId: string; locationId: string } | null = null;
let squareConfigLocationId: number | null | undefined = undefined;
let preWarmedCard: SquareCard | null = null;

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
  } catch (err) {
    console.error('[Square] Failed to pre-warm card:', err);
    preWarmedCard = null;
  }
}

export function getPreWarmedCard(): SquareCard | null {
  const card = preWarmedCard;
  preWarmedCard = null;
  return card;
}

export { cardStyle };

export function resetSquarePayments() {
  payments = null;
  squareConfig = null;
  squareConfigLocationId = undefined;
}

async function getSquareConfig(locationId?: number | null): Promise<{ appId: string; locationId: string }> {
  // Return cached config only if the location matches
  if (squareConfig && squareConfigLocationId === (locationId ?? null)) return squareConfig;

  const url = locationId ? `/api/square/config?locationId=${locationId}` : '/api/square/config';
  let data: SquareConfigResponse;
  try {
    const res = await fetch(url);
    data = await res.json() as SquareConfigResponse;
  } catch (err) {
    console.error('[Square] Failed to fetch config from server:', err);
    throw new Error('Payment is temporarily unavailable. Please try again or contact support.');
  }

  if (!data.appId) {
    console.error('[Square] Server returned no appId in config response');
    throw new Error('Payment is temporarily unavailable. Please try again or contact support.');
  }

  squareConfig = { appId: data.appId, locationId: data.locationId || '' };
  squareConfigLocationId = locationId ?? null;
  return squareConfig;
}

function getSdkUrl(appId: string): string {
  const isProduction = appId.length > 0 && !appId.includes('sandbox-');
  return isProduction
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";
}

export async function initializeSquare(locationId?: number | null): Promise<SquarePayments> {
  try {
    // Reset if the location has changed
    if (payments && squareConfigLocationId !== (locationId ?? null)) {
      payments = null;
      squareConfig = null;
    }

    if (payments && window.Square?.payments) {
      return payments;
    }

    payments = null;

    const config = await getSquareConfig(locationId);
    const sdkUrl = getSdkUrl(config.appId);
    const isProduction = config.appId.length > 0 && !config.appId.includes('sandbox-');


    if (window.Square && !window.Square.payments) {
      document.querySelectorAll('script[src*="square.js"]').forEach(script => script.remove());
      (window as { Square?: typeof window.Square }).Square = undefined;
    }

    const existingSdkScript = document.querySelector('script[src*="square"]') as HTMLScriptElement | null;
    if (existingSdkScript && existingSdkScript.src !== sdkUrl) {
      existingSdkScript.remove();
      (window as { Square?: typeof window.Square }).Square = undefined;
    }

    if (window.Square?.payments) {
      try {
        payments = await window.Square.payments(config.appId, config.locationId);
        return payments;
      } catch (initError) {
        console.error('[Square] Failed to initialize with existing SDK, will reload:', initError);
        document.querySelectorAll('script[src*="square.js"]').forEach(script => script.remove());
        (window as { Square?: typeof window.Square }).Square = undefined;
      }
    }

    const SQUARE_INIT_TIMEOUT_PROD_MS = 15000;
    const SQUARE_INIT_TIMEOUT_DEV_MS = 10000;
    const timeoutMs = isProduction ? SQUARE_INIT_TIMEOUT_PROD_MS : SQUARE_INIT_TIMEOUT_DEV_MS;
    const timeoutPromise = new Promise<SquarePayments>((_, reject) => {
      setTimeout(() => reject(new Error(`Square initialization timed out after ${timeoutMs/1000} seconds`)), timeoutMs);
    });

    const initializeFunction = async () => {
      let scriptLoaded = false;
      let attempts = 0;
      let lastError;

      while (!scriptLoaded && attempts < SDK_LOAD_MAX_ATTEMPTS) {
        attempts++;
        try {
          await loadScript(sdkUrl);
          scriptLoaded = true;
        } catch (err) {
          lastError = err;
          console.error(`[Square] Failed to load SDK on attempt ${attempts}/${SDK_LOAD_MAX_ATTEMPTS}:`, err);
          if (attempts < SDK_LOAD_MAX_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, SDK_LOAD_RETRY_DELAY_MS));
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

    while (attemptCount <= INIT_MAX_RETRIES) {
      try {
        const result = await Promise.race([
          initializeFunction(),
          timeoutPromise
        ]);
        return result;
      } catch (error) {
        attemptCount++;
        if (attemptCount <= INIT_MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, INIT_RETRY_DELAY_MS));
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

export async function tokenizeCard(cardInstance: SquareCard | null): Promise<string> {
  if (!cardInstance) {
    throw new Error(JSON.stringify({
      error: { message: 'Card element not initialized', code: 'INITIALIZATION_ERROR' }
    }));
  }
  const result = await cardInstance.tokenize();
  if (result.status === 'OK' && result.token) {
    return result.token;
  }
  throw new Error(JSON.stringify({
    error: { message: 'Please check your card details and try again.', code: 'TOKENIZATION_ERROR' }
  }));
}

export async function createPayment(amount: number, cardInstance: SquareCard | null, bowlerId: number, leagueId: number, storeCard: boolean = false): Promise<PaymentResult> {
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
          } catch {
            throw new Error(JSON.stringify({
              error: { message: 'Please check your card details and try again.', code: 'TOKENIZATION_ERROR' }
            }));
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

      const response = await csrfFetch('/api/square/payments', {
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
      const errorMessage = errors.map((e: { message: string }) => e.message).join(', ') || 'Card validation failed';
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
    const response = await csrfFetch('/api/square/customers', {
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

