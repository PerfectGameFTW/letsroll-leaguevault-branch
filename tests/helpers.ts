const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { message: string; code?: string };
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
    headers: { Cookie: cookies },
  });
  const data: ApiResponse<{ csrfToken: string }> = await res.json();
  return data.data?.csrfToken ?? '';
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  const res = await fetch(`${BASE_URL}${path}`, { headers });
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
    headers,
    body: JSON.stringify(body),
  });
  const data: ApiResponse<T> = await res.json();
  return { status: res.status, data };
}

export { BASE_URL };
