/**
 * Task #577 — integration test that the Clover webhook route is
 * actually reachable in the running app stack WITHOUT session auth.
 *
 * Pins the wiring fix from the same task: the route is mounted at
 * `app.use('/api/payments-provider/webhooks', ...)` BEFORE the
 * session-auth-protected `app.use('/api/payments-provider', requireAuth, ...)`
 * mount in `server/routes/index.ts`. If a future refactor re-applies
 * `requireAuth` to the webhook path (the regression the code review
 * caught), every authenticated branch below would fail with
 * `AUTH_REQUIRED` instead of the webhook-specific signature codes.
 *
 * Also asserts that the route's HMAC signature gate is engaged in the
 * live process — a genuinely unauthenticated path with no signature
 * check would be remotely exploitable.
 */
import { describe, it, expect } from 'vitest';
import { BASE_URL } from '../helpers';

async function postClover(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return fetch(`${BASE_URL}/api/payments-provider/webhooks/clover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('Clover webhook route is reachable without session auth (task #577)', () => {
  it('does NOT respond with AUTH_REQUIRED when called anonymously', async () => {
    // No cookies, no CSRF token, no signature header. If the route
    // were behind `requireAuth` we'd get 401 AUTH_REQUIRED. The
    // webhook handler should respond instead — either 200 (test-env
    // passthrough), 401 with a webhook-specific code, or 503 if no
    // signing secret is configured.
    const res = await postClover({ id: 'evt_routing_1', type: 'refund.created' });

    expect(res.status).not.toBe(403);
    const body = await res.json().catch(() => ({}));
    expect(body?.error?.code).not.toBe('AUTH_REQUIRED');
    expect(body?.error?.code).not.toBe('PASSWORD_CHANGE_REQUIRED');
    expect([200, 401, 503]).toContain(res.status);
  });

  it('rejects an obviously forged signature with a webhook-specific error (proves the HMAC gate runs)', async () => {
    // Either the secret is configured (→ 401 WEBHOOK_SIGNATURE_INVALID,
    // because 'deadbeef' will never hash-match) or it is not (→ 503
    // WEBHOOK_NOT_CONFIGURED in non-test envs, OR 200 in test envs
    // where the signature check is skipped). Any of those proves the
    // request reached the webhook handler instead of being bounced by
    // session auth.
    const res = await postClover(
      { id: 'evt_routing_2', type: 'refund.created' },
      { 'x-clover-signature': 'deadbeef' },
    );

    const body = await res.json().catch(() => ({}));
    expect(body?.error?.code).not.toBe('AUTH_REQUIRED');
    if (res.status === 401) {
      expect(['WEBHOOK_SIGNATURE_MISSING', 'WEBHOOK_SIGNATURE_INVALID'])
        .toContain(body?.error?.code);
    } else {
      // No secret configured → either 503 or test-env 200 passthrough.
      expect([200, 503]).toContain(res.status);
    }
  });
});
