/**
 * Regression tests for setup-admin secret-gate header normalization (#283).
 * See `checkSetupSecret` in server/routes/setup-admin.ts.
 *
 * Hits the dev server directly on localhost so `X-Forwarded-For` spoofing
 * actually isolates per-test rate-limit buckets under `setupAdminLimiter`
 * (5 req / 15 min / IP). `X-Forwarded-Proto: https` is set so
 * express-session accepts the secure session cookie used for CSRF.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { checkSetupSecret } from '../../server/routes/setup-admin';

// Intentionally bypasses the shared `tests/helpers.ts` BASE_URL (which
// prefers the Replit HTTPS domain) because `setupAdminLimiter` is
// 5 req / 15 min / IP and we need `X-Forwarded-For` to actually reach
// express-rate-limit's keyGenerator — only possible when we hit the
// trusted local hop directly.
const BASE_URL = process.env.SETUP_ADMIN_TEST_BASE_URL || 'http://localhost:5000';
const SETUP_SECRET = process.env.SETUP_SECRET;

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 250) + 1}`;
}

// --- unit harness: direct `checkSetupSecret` calls ---
// The non-string / array header shapes are pinned here (not per-endpoint
// HTTP) because Node's HTTP/1 parser collapses repeated headers into a
// single comma-joined string before the route handler ever sees them —
// the string[] branch of the normalization is only reachable via a
// direct call. The HTTP tests below still cover the "duplicated
// header" scenario end-to-end by asserting the collapsed shape is
// rejected.

function makeReq(headerValue: string | string[] | undefined): Request {
  const headers: Record<string, string | string[] | undefined> = {};
  if (headerValue !== undefined) headers['x-setup-secret'] = headerValue;
  return { headers } as unknown as Request;
}

function makeRes(): { res: Response; status: () => number | null; code: () => string | undefined } {
  let statusCode: number | null = null;
  let body: unknown = null;
  const res = {
    status(code: number) { statusCode = code; return this as unknown as Response; },
    json(payload: unknown) { body = payload; return this as unknown as Response; },
  } as unknown as Response;
  return {
    res,
    status: () => statusCode,
    code: () => (body as { error?: { code?: string } } | null)?.error?.code,
  };
}

describe('checkSetupSecret unit — header normalization', () => {
  if (!SETUP_SECRET) { it.skip('SETUP_SECRET not set', () => {}); return; }

  it('rejects a string[] header with bogus first element (no crash)', () => {
    const r = makeRes();
    expect(checkSetupSecret(makeReq(['bogus', SETUP_SECRET!]), r.res)).toBe(false);
    expect(r.status()).toBe(401);
    expect(r.code()).toBe('UNAUTHORIZED');
  });

  it('accepts a string[] header whose first element matches', () => {
    const r = makeRes();
    expect(checkSetupSecret(makeReq([SETUP_SECRET!, 'trailing']), r.res)).toBe(true);
    expect(r.status()).toBeNull();
  });

  it('rejects the comma-joined duplicate shape "bogus, <real>"', () => {
    const r = makeRes();
    expect(checkSetupSecret(makeReq(`bogus, ${SETUP_SECRET}`), r.res)).toBe(false);
    expect(r.status()).toBe(401);
  });

  it('rejects a non-string header body', () => {
    const r = makeRes();
    expect(checkSetupSecret(makeReq(123 as unknown as string), r.res)).toBe(false);
    expect(r.status()).toBe(401);
  });

  it('accepts the correct secret as a single string', () => {
    const r = makeRes();
    expect(checkSetupSecret(makeReq(SETUP_SECRET!), r.res)).toBe(true);
    expect(r.status()).toBeNull();
  });
});

// --- HTTP harness: per-endpoint coverage of the four required cases ---

interface EndpointSpec {
  label: string;
  path: string;
  body: () => unknown;
  needsCsrf: boolean;
}

const ENDPOINTS: EndpointSpec[] = [
  {
    label: 'POST /api/setup/create-first-admin',
    path: '/api/setup/create-first-admin',
    body: () => ({
      email: `setup-hdr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@vitest.local`,
      password: 'NotTheRealAdmin!2026',
      name: 'Setup Header Test',
    }),
    needsCsrf: false,
  },
  {
    label: 'POST /api/setup/first-system-admin/:id',
    path: '/api/setup/first-system-admin/0',
    body: () => ({}),
    needsCsrf: true,
  },
];

async function primeCsrf(): Promise<{ cookies: string; csrf: string }> {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, {
    headers: { 'X-Forwarded-For': freshIp(), 'X-Forwarded-Proto': 'https' },
  });
  if (!res.ok) throw new Error(`csrf prime failed: ${res.status}`);
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length === 0) throw new Error('csrf prime returned no Set-Cookie');
  const cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
  const body = (await res.json()) as { data?: { token?: string } };
  const csrf = body.data?.token ?? '';
  if (!csrf) throw new Error('csrf prime returned no token');
  return { cookies, csrf };
}

describe('setup-admin endpoints — per-endpoint secret-gate coverage', () => {
  if (!SETUP_SECRET) { it.skip('SETUP_SECRET not set', () => {}); return; }

  let cookies = '';
  let csrf = '';

  beforeAll(async () => {
    const primed = await primeCsrf();
    cookies = primed.cookies;
    csrf = primed.csrf;
  });

  async function post(
    ep: EndpointSpec,
    secret: string | string[] | undefined,
  ): Promise<{ status: number; code?: string }> {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('X-Forwarded-For', freshIp());
    headers.set('X-Forwarded-Proto', 'https');
    if (ep.needsCsrf) {
      headers.set('Cookie', cookies);
      headers.set('x-csrf-token', csrf);
    }
    if (Array.isArray(secret)) {
      for (const v of secret) headers.append('X-Setup-Secret', v);
    } else if (secret !== undefined) {
      headers.set('X-Setup-Secret', secret);
    }
    const res = await fetch(`${BASE_URL}${ep.path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(ep.body()),
    });
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* empty */ }
    return {
      status: res.status,
      code: (parsed as { error?: { code?: string } } | null)?.error?.code,
    };
  }

  for (const ep of ENDPOINTS) {
    describe(ep.label, () => {
      it('returns 401 when X-Setup-Secret is sent as a duplicated header', async () => {
        const out = await post(ep, ['bogus', SETUP_SECRET!]);
        expect(out.status).toBe(401);
        expect(out.code).toBe('UNAUTHORIZED');
      });

      it('returns 401 when no X-Setup-Secret header is present', async () => {
        const out = await post(ep, undefined);
        expect(out.status).toBe(401);
        expect(out.code).toBe('UNAUTHORIZED');
      });

      it('returns 401 when X-Setup-Secret is a wrong single value', async () => {
        const out = await post(ep, 'definitely-wrong');
        expect(out.status).toBe(401);
        expect(out.code).toBe('UNAUTHORIZED');
      });

      it('passes the secret gate when X-Setup-Secret is correct', async () => {
        const out = await post(ep, SETUP_SECRET!);
        expect(out.status).not.toBe(401);
        expect(out.status).not.toBe(500);
        if (out.code) {
          expect(out.code).not.toBe('UNAUTHORIZED');
          expect(out.code).not.toBe('CSRF_ERROR');
        }
      });
    });
  }
});
