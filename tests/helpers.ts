// Note: do not fall back to process.env.BASE_URL — the runtime sets it to "/"
// (Vite app-base-path convention), which produces invalid fetch URLs in tests.
//
// Default base URL prefers the Replit-served HTTPS domain when available,
// because the dev server sets `Secure` session cookies that are dropped
// over plain http://localhost. Outside of Replit the localhost fallback
// is used. Override explicitly with TEST_BASE_URL if needed.
const REPLIT_HOST = process.env.REPLIT_DEV_DOMAIN || (process.env.REPLIT_DOMAINS?.split(',')[0]);
const BASE_URL = process.env.TEST_BASE_URL || (REPLIT_HOST ? `https://${REPLIT_HOST}` : 'http://localhost:5000');

const TEST_ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@example.com';
const TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin-local-dev';
const TEST_ORG_A_EMAIL = process.env.TEST_ORG_A_EMAIL || 'testadmin@example.com';
const TEST_ORG_B_EMAIL = process.env.TEST_ORG_B_EMAIL || 'testadmin2@example.com';
const TEST_ORG_PASSWORD = process.env.TEST_ORG_PASSWORD || 'org-local-dev';
const TEST_NEW_ORG_ADMIN_PASSWORD = process.env.TEST_NEW_ORG_ADMIN_PASSWORD || 'new-org-admin-local-dev';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
}

/**
 * Both on Replit (HTTPS edge → loopback) and on GitHub CI (direct
 * loopback) every test request resolves to `req.ip = '127.0.0.1'`, so
 * test files that intentionally burst a per-IP rate limiter
 * (e.g. `payments-provider-guards`) will starve every later test in
 * the same vitest invocation that touches the same limiter.
 *
 * The server-side limiters in `server/middleware/rate-limit.ts` skip
 * enforcement when this header is present with the literal value `1`
 * AND `NODE_ENV !== 'production'`. The header value is intentionally a
 * fixed literal — the security gate is the NODE_ENV check, which
 * production deploys short-circuit on regardless of any header an
 * attacker might send. Using a literal (rather than the
 * `TRUST_PROXY_PROBE_TOKEN` secret used by `verify-trust-proxy-deploy`)
 * means the bypass works in every environment that runs the vitest
 * suite — including GitHub CI, which doesn't see Replit-only secrets.
 */
function withTestBypassHeader(headers: Record<string, string>): Record<string, string> {
  headers['x-test-rate-limit-bypass'] = '1';
  return headers;
}

export interface AuthSession {
  cookies: string;
  user: {
    id: number;
    email: string;
    name: string;
    role: string;
    organizationId: number | null;
  };
  csrfToken: string;
}

async function extractCookies(response: Response): Promise<string> {
  const setCookie = response.headers.getSetCookie?.() ?? [];
  return setCookie.map(c => c.split(';')[0]).join('; ');
}

async function getCsrfToken(cookies: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, {
    headers: withTestBypassHeader({ Cookie: cookies }),
  });
  const data: ApiResponse<{ token: string }> = await res.json();
  return data.data?.token ?? '';
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: withTestBypassHeader({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password }),
  });

  const cookies = await extractCookies(res);
  const data: ApiResponse = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(`Login failed for ${email}: ${data.error?.message ?? res.statusText}`);
  }

  const csrfToken = await getCsrfToken(cookies);

  return {
    cookies,
    user: data.data as AuthSession['user'],
    csrfToken,
  };
}

export async function apiGet<T = unknown>(
  path: string,
  session?: AuthSession,
): Promise<{ status: number; data: ApiResponse<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session) headers['Cookie'] = session.cookies;

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: withTestBypassHeader(headers),
  });
  const data: ApiResponse<T> = await res.json();
  return { status: res.status, data };
}

export async function apiPost<T = unknown>(
  path: string,
  body: unknown,
  session?: AuthSession,
): Promise<{ status: number; data: ApiResponse<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session) {
    headers['Cookie'] = session.cookies;
    headers['x-csrf-token'] = session.csrfToken;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: withTestBypassHeader(headers),
    body: JSON.stringify(body),
  });
  const data: ApiResponse<T> = await res.json();
  return { status: res.status, data };
}

export async function apiPatch<T = unknown>(
  path: string,
  body: unknown,
  session?: AuthSession,
): Promise<{ status: number; data: ApiResponse<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session) {
    headers['Cookie'] = session.cookies;
    headers['x-csrf-token'] = session.csrfToken;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: withTestBypassHeader(headers),
    body: JSON.stringify(body),
  });
  const data: ApiResponse<T> = await res.json();
  return { status: res.status, data };
}

export async function apiDelete<T = unknown>(
  path: string,
  session?: AuthSession,
): Promise<{ status: number; data: ApiResponse<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session) {
    headers['Cookie'] = session.cookies;
    headers['x-csrf-token'] = session.csrfToken;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: withTestBypassHeader(headers),
  });
  const data: ApiResponse<T> = await res.json();
  return { status: res.status, data };
}

export {
  BASE_URL,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_B_EMAIL,
  TEST_ORG_PASSWORD,
  TEST_NEW_ORG_ADMIN_PASSWORD,
};
