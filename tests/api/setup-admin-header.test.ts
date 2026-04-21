/**
 * Regression tests for `checkSetupSecret` header normalization (task #283).
 *
 * The helper in `server/routes/setup-admin.ts` must treat every weird shape
 * of the `x-setup-secret` header (missing, empty, duplicated / string[],
 * correct) as a fail-closed 401 except when a single, exactly-matching
 * string is supplied. A future refactor that drops either the
 * `Array.isArray(rawSecret) ? rawSecret[0] : rawSecret` normalization or
 * the non-string short-circuit inside `safeTokenCompare` would reintroduce
 * the 500-on-array regression this test pins.
 *
 * Coverage split:
 *   - Unit level: call `checkSetupSecret` directly with mocked req/res so
 *     we can exercise the `string[]` branch that Node's HTTP parser
 *     collapses into a comma-joined string before the handler ever sees
 *     it. This is the branch the audit flagged.
 *   - HTTP level: hit both real endpoints (`POST /api/setup/create-first-admin`
 *     and `POST /api/setup/first-system-admin/:id`) end-to-end with a
 *     correct secret to pin the wiring — the secret gate passes and the
 *     response is NOT 401 (downstream status depends on admin state and
 *     is not the subject of this test).
 *
 * The HTTP slice is kept small on purpose: `setupAdminLimiter` is 5 req /
 * 15 min and the IP seen by `express-rate-limit` is opaque behind Replit's
 * proxy chain, so we do not rely on `X-Forwarded-For` spoofing to stay
 * under the limit — we simply make two requests.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { checkSetupSecret } from '../../server/routes/setup-admin';

const REPLIT_HOST = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0];
const BASE_URL = process.env.TEST_BASE_URL || (REPLIT_HOST ? `https://${REPLIT_HOST}` : 'http://localhost:5000');
const SETUP_SECRET = process.env.SETUP_SECRET;

// ---------- unit-test helpers ------------------------------------------------

function makeReq(headerValue: string | string[] | undefined): Request {
  const headers: Record<string, string | string[] | undefined> = {};
  if (headerValue !== undefined) headers['x-setup-secret'] = headerValue;
  return { headers } as unknown as Request;
}

interface RecordedResponse {
  status: number | null;
  body: unknown;
}

function makeRes(): { res: Response; recorded: RecordedResponse } {
  const recorded: RecordedResponse = { status: null, body: null };
  const res = {
    status(code: number) {
      recorded.status = code;
      return this as unknown as Response;
    },
    json(payload: unknown) {
      recorded.body = payload;
      return this as unknown as Response;
    },
  } as unknown as Response;
  return { res, recorded };
}

function errCode(body: unknown): string | undefined {
  return (body as { error?: { code?: string } } | null)?.error?.code;
}

// ---------- unit tests: header-normalization contract ----------------------

describe('checkSetupSecret — header normalization (task #283)', () => {
  if (!SETUP_SECRET) {
    it.skip('SETUP_SECRET is not set in the test environment', () => {});
    return;
  }

  it('rejects a string[] header value (HTTP/2 / proxy shape) with 401, never 500', () => {
    // The branch `Array.isArray(rawSecret) ? rawSecret[0] : rawSecret` is
    // the load-bearing piece. Simulate what a proxy / HTTP/2 parser can
    // deliver: a real JS array. Even if the first element happens to be
    // the real secret, downstream code must not crash on later elements.
    const { res, recorded } = makeRes();
    const ok = checkSetupSecret(
      makeReq(['bogus-first-value', SETUP_SECRET!]),
      res,
    );
    expect(ok).toBe(false);
    expect(recorded.status).toBe(401);
    expect(errCode(recorded.body)).toBe('UNAUTHORIZED');
  });

  it('still accepts when the array happens to contain the real secret as its first element', () => {
    // Pins the documented "first element wins" behavior of the
    // normalization. If a refactor drops the [0] index the caller would
    // start comparing the whole array (non-string) and silently 401 a
    // legitimate request. Either behavior is defensible — this test pins
    // the current contract so the change is caught.
    const { res, recorded } = makeRes();
    const ok = checkSetupSecret(makeReq([SETUP_SECRET!, 'trailing']), res);
    expect(ok).toBe(true);
    expect(recorded.status).toBeNull();
  });

  it('rejects a missing header with 401', () => {
    const { res, recorded } = makeRes();
    const ok = checkSetupSecret(makeReq(undefined), res);
    expect(ok).toBe(false);
    expect(recorded.status).toBe(401);
    expect(errCode(recorded.body)).toBe('UNAUTHORIZED');
  });

  it('rejects an empty-string header with 401', () => {
    const { res, recorded } = makeRes();
    const ok = checkSetupSecret(makeReq(''), res);
    expect(ok).toBe(false);
    expect(recorded.status).toBe(401);
    expect(errCode(recorded.body)).toBe('UNAUTHORIZED');
  });

  it('rejects a non-matching string with 401 (not 500)', () => {
    const { res, recorded } = makeRes();
    const ok = checkSetupSecret(makeReq('definitely-not-the-secret'), res);
    expect(ok).toBe(false);
    expect(recorded.status).toBe(401);
    expect(errCode(recorded.body)).toBe('UNAUTHORIZED');
  });

  it('rejects a comma-joined duplicated-header string (HTTP/1 parser shape) with 401', () => {
    // Node's HTTP/1 parser collapses repeated non-special headers into a
    // single comma-separated string (e.g. `"a, b"`). Even if the real
    // secret is one of the values, the joined form must not match — this
    // pins that `safeTokenCompare` does a length-exact comparison and
    // does not split-and-compare.
    const { res, recorded } = makeRes();
    const ok = checkSetupSecret(makeReq(`bogus, ${SETUP_SECRET}`), res);
    expect(ok).toBe(false);
    expect(recorded.status).toBe(401);
    expect(errCode(recorded.body)).toBe('UNAUTHORIZED');
  });

  it('rejects a non-string body — object shape — with 401 (not 500)', () => {
    // Defense-in-depth: even if someone passes a structured object into
    // the header bag (shouldn't happen via HTTP, but a middleware might),
    // `safeTokenCompare` must still refuse it without crashing.
    const { res, recorded } = makeRes();
    const ok = checkSetupSecret(
      makeReq(123 as unknown as string),
      res,
    );
    expect(ok).toBe(false);
    expect(recorded.status).toBe(401);
  });

  it('accepts the correct secret supplied as a single string', () => {
    const { res, recorded } = makeRes();
    const ok = checkSetupSecret(makeReq(SETUP_SECRET!), res);
    expect(ok).toBe(true);
    expect(recorded.status).toBeNull();
  });
});

// ---------- integration slice: endpoint wiring -----------------------------

describe('setup-secret gate — HTTP wiring (task #283)', () => {
  if (!SETUP_SECRET) {
    it.skip('SETUP_SECRET is not set in the test environment', () => {});
    return;
  }

  let sessionCookies = '';
  let csrfToken = '';

  beforeAll(async () => {
    // `/setup/first-system-admin/:id` is NOT CSRF-exempt (only
    // `/setup/create-first-admin` is), so we need a session + csrf
    // header to reach its handler. A silent fallback to empty cookies
    // would turn every wiring assertion into a false-positive against
    // the CSRF layer, so fail loud if capture breaks.
    const res = await fetch(`${BASE_URL}/api/csrf-token`);
    if (!res.ok) throw new Error(`csrf-token prime failed: ${res.status}`);
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length === 0) {
      throw new Error('csrf-token prime returned no Set-Cookie; test would silently bypass CSRF');
    }
    sessionCookies = setCookie.map((c) => c.split(';')[0]).join('; ');
    const body = (await res.json()) as { data?: { token?: string } };
    csrfToken = body.data?.token ?? '';
    if (!csrfToken) {
      throw new Error('csrf-token prime returned no token; test would silently bypass CSRF');
    }
  });

  async function post(path: string, body: unknown, secret?: string): Promise<{ status: number; code?: string }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sessionCookies) headers['Cookie'] = sessionCookies;
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    if (secret !== undefined) headers['X-Setup-Secret'] = secret;
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
    });
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* empty */ }
    return { status: res.status, code: errCode(parsed) };
  }

  // Kept small (4 HTTP requests total) on purpose: `setupAdminLimiter`
  // caps at 5 req / 15 min / IP and the client IP seen by
  // express-rate-limit behind Replit's proxy chain is opaque, so we
  // cannot reliably spoof it via X-Forwarded-For.
  const adminBody = () => ({
    email: `setup-header-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@vitest.local`,
    password: 'NotTheRealAdmin!2026',
    name: 'Setup Header Test',
  });

  it('POST /api/setup/create-first-admin — wrong secret returns 401 UNAUTHORIZED', async () => {
    const out = await post('/api/setup/create-first-admin', adminBody(), 'definitely-wrong');
    expect(out.status).toBe(401);
    expect(out.code).toBe('UNAUTHORIZED');
  });

  it('POST /api/setup/create-first-admin — correct secret passes the secret gate', async () => {
    const out = await post('/api/setup/create-first-admin', adminBody(), SETUP_SECRET);
    // Secret gate passed — downstream returns ADMIN_EXISTS / EMAIL_EXISTS /
    // 201 depending on env state. What's pinned: NOT 401, NOT 500, and
    // if an error code is present it is not UNAUTHORIZED — proving the
    // request reached the handler past checkSetupSecret.
    expect(out.status).not.toBe(401);
    expect(out.status).not.toBe(500);
    if (out.code) expect(out.code).not.toBe('UNAUTHORIZED');
  });

  it('POST /api/setup/first-system-admin/:id — wrong secret returns 401 UNAUTHORIZED', async () => {
    const out = await post('/api/setup/first-system-admin/0', {}, 'definitely-wrong');
    // Guards against a silent CSRF_ERROR false-positive: we must see
    // UNAUTHORIZED specifically (proving the request reached
    // checkSetupSecret past CSRF) and never a 500.
    expect(out.status).toBe(401);
    expect(out.code).toBe('UNAUTHORIZED');
  });

  it('POST /api/setup/first-system-admin/:id — correct secret passes the secret gate', async () => {
    const out = await post('/api/setup/first-system-admin/0', {}, SETUP_SECRET);
    expect(out.status).not.toBe(401);
    expect(out.status).not.toBe(500);
    if (out.code) {
      expect(out.code).not.toBe('UNAUTHORIZED');
      // Also reject CSRF false-positives — if we see CSRF_ERROR here the
      // prime above failed silently and none of the wiring assertions
      // actually proved anything.
      expect(out.code).not.toBe('CSRF_ERROR');
    }
  });
});

// Keeps `vi` in the import list if we later need spies; avoids lint noise.
void vi;
