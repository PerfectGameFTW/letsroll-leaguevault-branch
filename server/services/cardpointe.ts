import { createLogger } from '../logger';

const log = createLogger('CardPointeService');

export interface CardPointeCredentials {
  merchantId: string;
  apiUsername: string;
  apiPassword: string;
  siteUrl: string;
}

export interface CardPointeAuthResponse {
  respstat: string;
  retref: string;
  account: string;
  token: string;
  amount: string;
  merchid: string;
  respcode: string;
  resptext: string;
  authcode: string;
  profileid?: string;
  acctid?: string;
}

export interface CardPointeProfileResponse {
  profileid: string;
  acctid: string;
  respstat: string;
  respcode: string;
  resptext: string;
  token: string;
  accttype?: string;
  expiry?: string;
  name?: string;
}

export interface CardPointeRefundResponse {
  retref: string;
  amount: string;
  merchid: string;
  respstat: string;
  respcode: string;
  resptext: string;
  authcode?: string;
}

export interface CardPointeVoidResponse {
  retref: string;
  amount: string;
  merchid: string;
  respstat: string;
  respcode: string;
  resptext: string;
  authcode: string;
}

export interface CardPointeInquireResponse {
  retref: string;
  amount: string;
  merchid: string;
  respstat: string;
  respcode: string;
  resptext: string;
  authcode: string;
  setlstat: string;
  account: string;
  token: string;
}

function buildBaseUrl(siteUrl: string): string {
  const cleanSite = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (cleanSite.includes('.')) {
    return `https://${cleanSite}/cardconnect/rest`;
  }
  return `https://${cleanSite}.cardconnect.com/cardconnect/rest`;
}

function buildAuthHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

async function cpRequest<T>(
  creds: CardPointeCredentials,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
  retries = 2,
): Promise<T> {
  const baseUrl = buildBaseUrl(creds.siteUrl);
  const url = `${baseUrl}/${path}`;
  const authHeader = buildAuthHeader(creds.apiUsername, creds.apiPassword);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
      };
      if (body && (method === 'PUT' || method === 'POST')) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`CardPointe API error ${response.status}: ${text}`);
      }

      const data = await response.json() as T;
      return data;
    } catch (error) {
      if (attempt < retries && isRetryable(error)) {
        const delay = Math.pow(2, attempt) * 500;
        log.warn(`CardPointe request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`, {
          path,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('CardPointe request failed after retries');
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('timeout') || msg.includes('econnreset') || msg.includes('502') || msg.includes('503') || msg.includes('504');
  }
  return false;
}

export async function authorizeTransaction(
  creds: CardPointeCredentials,
  params: {
    account: string;
    amount: string;
    currency?: string;
    capture?: string;
    profile?: string;
    accttype?: string;
    orderid?: string;
    name?: string;
    email?: string;
  },
): Promise<CardPointeAuthResponse> {
  const body: Record<string, unknown> = {
    merchid: creds.merchantId,
    account: params.account,
    amount: params.amount,
    currency: params.currency ?? 'USD',
    capture: params.capture ?? 'Y',
    ...params.profile !== undefined && { profile: params.profile },
    ...params.accttype !== undefined && { accttype: params.accttype },
    ...params.orderid !== undefined && { orderid: params.orderid },
    ...params.name !== undefined && { name: params.name },
    ...params.email !== undefined && { email: params.email },
  };

  const result = await cpRequest<CardPointeAuthResponse>(creds, 'PUT', 'auth', body);

  if (result.respstat !== 'A') {
    log.error('CardPointe authorization declined/error', {
      respstat: result.respstat,
      respcode: result.respcode,
      resptext: result.resptext,
    });
    throw new Error(JSON.stringify({
      error: {
        message: result.resptext || 'Payment was declined',
        code: result.respstat === 'C' ? 'PAYMENT_DECLINED' : 'PAYMENT_FAILED',
      },
    }));
  }

  return result;
}

export async function voidTransaction(
  creds: CardPointeCredentials,
  retref: string,
  amount?: string,
): Promise<CardPointeVoidResponse> {
  const body: Record<string, unknown> = {
    merchid: creds.merchantId,
    retref,
  };
  if (amount !== undefined) {
    body.amount = amount;
  }

  const result = await cpRequest<CardPointeVoidResponse>(creds, 'PUT', 'void', body);

  if (result.respstat !== 'A') {
    throw new Error(`CardPointe void failed: ${result.resptext}`);
  }

  return result;
}

export async function refundTransaction(
  creds: CardPointeCredentials,
  retref: string,
  amount?: string,
): Promise<CardPointeRefundResponse> {
  const body: Record<string, unknown> = {
    merchid: creds.merchantId,
    retref,
  };
  if (amount !== undefined) {
    body.amount = amount;
  }

  const result = await cpRequest<CardPointeRefundResponse>(creds, 'PUT', 'refund', body);

  if (result.respstat !== 'A') {
    throw new Error(`CardPointe refund failed: ${result.resptext}`);
  }

  return result;
}

export async function createOrUpdateProfile(
  creds: CardPointeCredentials,
  params: {
    account: string;
    profileid?: string;
    accttype?: string;
    expiry?: string;
    name?: string;
    defaultacct?: string;
  },
): Promise<CardPointeProfileResponse> {
  const body: Record<string, unknown> = {
    merchid: creds.merchantId,
    account: params.account,
    ...params.profileid !== undefined && { profileid: params.profileid },
    ...params.accttype !== undefined && { accttype: params.accttype },
    ...params.expiry !== undefined && { expiry: params.expiry },
    ...params.name !== undefined && { name: params.name },
    defaultacct: params.defaultacct ?? 'Y',
  };

  const result = await cpRequest<CardPointeProfileResponse>(creds, 'PUT', 'profile', body);

  if (result.respstat !== 'A') {
    throw new Error(`CardPointe profile creation failed: ${result.resptext}`);
  }

  return result;
}

export async function getProfile(
  creds: CardPointeCredentials,
  profileId: string,
  accountId?: string,
): Promise<CardPointeProfileResponse[]> {
  const acctPart = accountId ?? '';
  const path = `profile/${profileId}/${acctPart}/${creds.merchantId}`;
  const result = await cpRequest<CardPointeProfileResponse[] | CardPointeProfileResponse>(creds, 'GET', path);
  return Array.isArray(result) ? result : [result];
}

export async function deleteProfile(
  creds: CardPointeCredentials,
  profileId: string,
  accountId?: string,
): Promise<void> {
  const acctPart = accountId ?? '';
  const path = `profile/${profileId}/${acctPart}/${creds.merchantId}`;
  await cpRequest<{ respstat: string; resptext: string }>(creds, 'DELETE', path);
}

export async function inquireTransaction(
  creds: CardPointeCredentials,
  retref: string,
): Promise<CardPointeInquireResponse> {
  const path = `inquire/${retref}/${creds.merchantId}`;
  return cpRequest<CardPointeInquireResponse>(creds, 'GET', path);
}

export function formatAmountForCardPointe(amountInCents: number): string {
  return (amountInCents / 100).toFixed(2);
}

export function parseCardPointeAmount(amount: string): number {
  return Math.round(parseFloat(amount) * 100);
}

export function mapCardBrand(accttype?: string): string {
  const brandMap: Record<string, string> = {
    VISA: 'VISA',
    MC: 'MASTERCARD',
    AMEX: 'AMERICAN_EXPRESS',
    DISC: 'DISCOVER',
    DSCR: 'DISCOVER',
    JCB: 'JCB',
    DNRS: 'DINERS_CLUB',
  };
  return brandMap[accttype ?? ''] ?? accttype ?? 'UNKNOWN';
}

export function extractLast4(account: string): string {
  const cleaned = account.replace(/[^0-9X*]/g, '');
  return cleaned.slice(-4);
}

export function detectBrandFromToken(token: string): string | undefined {
  if (!token) return undefined;
  const clean = token.replace(/\D/g, '');
  if (!clean) return undefined;
  if (clean.startsWith('4')) return 'VISA';
  if (clean.startsWith('5') || clean.startsWith('2')) return 'MC';
  if (clean.startsWith('3') && (clean[1] === '4' || clean[1] === '7')) return 'AMEX';
  if (clean.startsWith('6')) return 'DISC';
  return undefined;
}
