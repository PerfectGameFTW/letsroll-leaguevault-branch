import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { createSharedRateLimitStore } from "../utils/rate-limit-store";

// Task #356: every limiter below is backed by the shared Postgres
// store so quotas hold across multiple app processes / replicas.
// Each limiter MUST pass a unique `prefix` to keep its key
// namespace isolated from sibling limiters.

const rateLimitMessage = (msg: string) => ({
  success: false,
  error: { message: msg, code: "RATE_LIMITED" }
});

function userKeyGenerator(req: Request): string {
  return req.user?.id?.toString() || ipKeyGenerator(req.ip ?? 'unknown');
}

/**
 * Test-only bypass for the limiters below.
 *
 * The vitest suite drives the long-running dev server through Replit's
 * HTTPS edge, which prepends multiple proxy hops to `X-Forwarded-For`.
 * With `app.set('trust proxy', 1)` the rightmost hop wins, so every
 * test request resolves to `req.ip = '127.0.0.1'` regardless of any
 * header the test sets — meaning a single test file that intentionally
 * fires a burst (e.g. `payments-provider-guards.test.ts`) drains the
 * loopback bucket and starves any later test that touches the same
 * limiter in the same vitest invocation.
 *
 * This bypass is gated on:
 *   1. `NODE_ENV !== 'production'` — the production deploy can never
 *      trip this path even if a token leaks.
 *   2. The request carrying `X-Test-Rate-Limit-Bypass` whose value
 *      matches the existing `TRUST_PROXY_PROBE_TOKEN` secret. Reusing
 *      that secret avoids introducing a new env var; it is already
 *      treated as a server-only test/diagnostic credential (see
 *      `server/lib/trust-proxy-check.ts`).
 *
 * Tests opt in by setting the header in `tests/helpers.ts`.
 */
function testBypassSkip(req: Request): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const expected = process.env.TRUST_PROXY_PROBE_TOKEN;
  if (!expected) return false;
  const provided = req.header('x-test-rate-limit-bypass');
  return provided === expected;
}

export const paymentWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('payment-write'),
  message: rateLimitMessage("Too many payment requests, please try again later"),
  skip: testBypassSkip,
});

export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('payment'),
  message: rateLimitMessage("Too many payment requests, please try again later"),
  skip: testBypassSkip,
});

export const adminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('admin-write'),
  message: rateLimitMessage("Too many admin requests, please try again later"),
  skip: testBypassSkip,
});

export const emailTestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('email-test'),
  message: rateLimitMessage("Too many test email requests, please try again later"),
  skip: testBypassSkip,
});

export const setupAdminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('setup-admin'),
  message: rateLimitMessage("Too many setup requests, please try again later"),
  skip: testBypassSkip,
});

export const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  store: createSharedRateLimitStore('invite'),
  message: rateLimitMessage("Too many invite requests, please try again later"),
  skip: testBypassSkip,
});
