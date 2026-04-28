/**
 * Low-level Clover Ecommerce REST API client.
 *
 * Clover Ecommerce uses Bearer token authentication and a
 * Stripe-shaped API surface (charges, customers, refunds). Hosts:
 *   - sandbox:    https://scl-sandbox.dev.clover.com
 *   - production: https://scl.clover.com
 *
 * Endpoints used by LeagueVault:
 *   - POST /v1/charges                    — one-off and saved-card charges
 *   - POST /v1/customers                  — create customer
 *   - GET  /v1/customers/{id}             — fetch (used opportunistically)
 *   - POST /v1/customers/{id}/cards       — vault a card token onto a customer
 *   - GET  /v1/customers/{id}/cards       — list vaulted cards
 *   - DELETE /v1/customers/{id}/cards/{cardId} — remove a vaulted card
 *   - DELETE /v1/customers/{id}           — delete a customer (account-deletion)
 *   - POST /v1/refunds                    — refund an existing charge
 *   - GET  /v1/charges/{id}               — verify / look up an existing charge
 *
 * All responses are returned as parsed JSON. Network and HTTP-error
 * cases are surfaced as `CloverApiError` (4xx/5xx) or a thrown
 * `Error` (transport failures); callers in `clover-provider.ts` map
 * these onto the typed `PaymentProviderError` shape used by the rest
 * of the app.
 */
import { createLogger } from '../logger';
import type { CloverEnvironment } from '@shared/schema';

const log = createLogger('Clover');

export interface CloverCredentials {
  apiToken: string;
  merchantId: string;
  environment: CloverEnvironment;
}

const HOSTS: Record<CloverEnvironment, string> = {
  sandbox: 'https://scl-sandbox.dev.clover.com',
  production: 'https://scl.clover.com',
};

export class CloverApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;
  public readonly code?: string;

  constructor(message: string, status: number, body: unknown, code?: string) {
    super(message);
    this.name = 'CloverApiError';
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

interface CloverErrorBody {
  message?: string;
  error?: { message?: string; code?: string };
  code?: string;
}

function baseUrl(creds: CloverCredentials): string {
  return HOSTS[creds.environment];
}

async function request<T>(
  creds: CloverCredentials,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${baseUrl(creds)}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.apiToken}`,
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const errBody = (parsed ?? {}) as CloverErrorBody;
    const message =
      errBody.error?.message ||
      errBody.message ||
      `Clover ${method} ${path} failed with status ${res.status}`;
    const code = errBody.error?.code || errBody.code;
    throw new CloverApiError(message, res.status, parsed, code);
  }

  return parsed as T;
}

export interface CloverCharge {
  id: string;
  amount: number;
  currency: string;
  status?: string;
  customer?: string;
  source?: {
    id?: string;
    last4?: string;
    brand?: string;
    exp_month?: number;
    exp_year?: number;
  };
  created?: number;
}

export async function createCharge(
  creds: CloverCredentials,
  params: {
    amount: number;
    source: string;
    customer?: string;
    capture?: boolean;
    description?: string;
    receiptEmail?: string;
    ecomind?: 'ecom' | 'moto';
    externalReferenceId?: string;
  },
): Promise<CloverCharge> {
  const body: Record<string, unknown> = {
    amount: params.amount,
    currency: 'usd',
    source: params.source,
    capture: params.capture ?? true,
    ecomind: params.ecomind ?? 'ecom',
  };
  if (params.customer) body.customer = params.customer;
  if (params.description) body.description = params.description;
  if (params.receiptEmail) body.receipt_email = params.receiptEmail;
  if (params.externalReferenceId) body.external_reference_id = params.externalReferenceId;
  return request<CloverCharge>(creds, 'POST', '/v1/charges', body);
}

export async function getCharge(
  creds: CloverCredentials,
  chargeId: string,
): Promise<CloverCharge> {
  return request<CloverCharge>(creds, 'GET', `/v1/charges/${encodeURIComponent(chargeId)}`);
}

export interface CloverRefund {
  id: string;
  amount: number;
  charge: string;
  status?: string;
}

export async function createRefund(
  creds: CloverCredentials,
  params: { charge: string; amount?: number; reason?: string },
): Promise<CloverRefund> {
  const body: Record<string, unknown> = { charge: params.charge };
  if (params.amount !== undefined) body.amount = params.amount;
  if (params.reason) body.reason = params.reason;
  return request<CloverRefund>(creds, 'POST', '/v1/refunds', body);
}

export interface CloverCustomer {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  externalReferenceId?: string;
}

export async function createCustomer(
  creds: CloverCredentials,
  params: {
    email: string;
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
    externalReferenceId?: string;
  },
): Promise<CloverCustomer> {
  const body: Record<string, unknown> = { email: params.email };
  if (params.firstName) body.firstName = params.firstName;
  if (params.lastName) body.lastName = params.lastName;
  if (params.phoneNumber) body.phoneNumber = params.phoneNumber;
  if (params.externalReferenceId) body.externalReferenceId = params.externalReferenceId;
  return request<CloverCustomer>(creds, 'POST', '/v1/customers', body);
}

export async function getCustomer(
  creds: CloverCredentials,
  customerId: string,
): Promise<CloverCustomer | null> {
  try {
    return await request<CloverCustomer>(
      creds,
      'GET',
      `/v1/customers/${encodeURIComponent(customerId)}`,
    );
  } catch (error) {
    if (error instanceof CloverApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function deleteCustomer(
  creds: CloverCredentials,
  customerId: string,
): Promise<void> {
  try {
    await request<unknown>(creds, 'DELETE', `/v1/customers/${encodeURIComponent(customerId)}`);
  } catch (error) {
    if (error instanceof CloverApiError && error.status === 404) {
      log.info('Clover customer already absent, treating as deleted', { customerId });
      return;
    }
    throw error;
  }
}

export interface CloverSource {
  id: string;
  last4?: string;
  brand?: string;
  exp_month?: number;
  exp_year?: number;
}

interface CloverSourceList {
  cards?: CloverSource[];
  sources?: CloverSource[];
  data?: CloverSource[];
  elements?: CloverSource[];
}

export async function createCustomerSource(
  creds: CloverCredentials,
  customerId: string,
  source: string,
): Promise<CloverSource> {
  return request<CloverSource>(
    creds,
    'POST',
    `/v1/customers/${encodeURIComponent(customerId)}/cards`,
    { source },
  );
}

export async function listCustomerSources(
  creds: CloverCredentials,
  customerId: string,
): Promise<CloverSource[]> {
  const result = await request<CloverSourceList>(
    creds,
    'GET',
    `/v1/customers/${encodeURIComponent(customerId)}/cards`,
  );
  return result.cards || result.sources || result.data || result.elements || [];
}

export async function deleteCustomerSource(
  creds: CloverCredentials,
  customerId: string,
  sourceId: string,
): Promise<void> {
  await request<unknown>(
    creds,
    'DELETE',
    `/v1/customers/${encodeURIComponent(customerId)}/cards/${encodeURIComponent(sourceId)}`,
  );
}

export function mapCloverBrand(brand: string | undefined): string {
  if (!brand) return 'UNKNOWN';
  const normalized = brand.toUpperCase();
  if (normalized.includes('VISA')) return 'VISA';
  if (normalized.includes('MASTER')) return 'MASTERCARD';
  if (normalized.includes('AMEX') || normalized.includes('AMERICAN')) return 'AMERICAN_EXPRESS';
  if (normalized.includes('DISC')) return 'DISCOVER';
  return normalized;
}
