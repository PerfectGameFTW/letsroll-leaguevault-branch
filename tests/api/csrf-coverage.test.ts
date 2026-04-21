/**
 * Regression tests for CSRF coverage on session-mutating routes (task #297).
 *
 * Pins three contracts:
 *  1. `PATCH /api/account/profile/:id` requires a valid CSRF token (was
 *     audit-flagged).
 *  2. `POST /api/account/change-password` requires a valid CSRF token (was
 *     audit-flagged).
 *  3. `POST /api/setup/first-system-admin/:id` is EXEMPT from CSRF — it is
 *     the disaster-recovery promote-to-admin endpoint and is authenticated
 *     by the `x-setup-secret` header from `curl`, before any browser
 *     session exists. Added to `EXEMPT_PATHS` in this audit; this test
 *     prevents a regression that would re-break the recovery flow.
 *
 * For (3) we only assert the absence of `CSRF_ERROR` — the endpoint still
 * rejects the call for other reasons (missing setup secret, an admin
 * already exists), and we don't want a CSRF regression to be hidden by
 * those downstream rejections.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  login,
  type AuthSession,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

const REPLIT_HOST = process.env.REPLIT_DEV_DOMAIN || (process.env.REPLIT_DOMAINS?.split(',')[0]);
const BASE_URL = process.env.TEST_BASE_URL || (REPLIT_HOST ? `https://${REPLIT_HOST}` : 'http://localhost:5000');

interface ApiResponse {
  success: boolean;
  data?: unknown;
  error?: { message: string; code?: string };
}

async function rawRequest(
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: ApiResponse }> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  const body = await res.json().catch(() => ({ success: false } as ApiResponse));
  return { status: res.status, body };
}

describe('CSRF coverage on session-mutating routes', () => {
  let orgAdmin: AuthSession;

  beforeAll(async () => {
    orgAdmin = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
  });

  describe('PATCH /api/account/profile/:id', () => {
    it('returns 403 CSRF_ERROR without an x-csrf-token header', async () => {
      const { status, body } = await rawRequest(
        `/api/account/profile/${orgAdmin.user.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: orgAdmin.cookies,
          },
          body: JSON.stringify({ name: 'CSRF Test' }),
        },
      );
      expect(status).toBe(403);
      expect(body.error?.code).toBe('CSRF_ERROR');
    });

    it('does NOT 403 CSRF_ERROR when the valid token is included', async () => {
      const { status, body } = await rawRequest(
        `/api/account/profile/${orgAdmin.user.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: orgAdmin.cookies,
            'x-csrf-token': orgAdmin.csrfToken,
          },
          body: JSON.stringify({ name: 'CSRF Test' }),
        },
      );
      // We don't pin status=200 because the handler may surface validation
      // / business-logic outcomes on this body shape; we only need to
      // prove the CSRF gate let the request through.
      expect(body.error?.code).not.toBe('CSRF_ERROR');
      expect(status).not.toBe(403);
    });
  });

  describe('POST /api/account/change-password', () => {
    it('returns 403 CSRF_ERROR without an x-csrf-token header', async () => {
      const { status, body } = await rawRequest('/api/account/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: orgAdmin.cookies,
        },
        body: JSON.stringify({
          currentPassword: 'wrong-on-purpose',
          newPassword: 'NewPassw0rd!Strong',
        }),
      });
      expect(status).toBe(403);
      expect(body.error?.code).toBe('CSRF_ERROR');
    });

    it('does NOT 403 CSRF_ERROR when the valid token is included', async () => {
      // Intentionally send an invalid current password so the request
      // passes the CSRF gate but the handler safely rejects it with
      // INVALID_PASSWORD — proving CSRF was honored without actually
      // mutating the test user's password.
      const { status, body } = await rawRequest('/api/account/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: orgAdmin.cookies,
          'x-csrf-token': orgAdmin.csrfToken,
        },
        body: JSON.stringify({
          currentPassword: 'definitely-not-the-real-password',
          newPassword: 'NewPassw0rd!Strong',
        }),
      });
      expect(body.error?.code).not.toBe('CSRF_ERROR');
      expect(status).not.toBe(403);
      // Sanity-check: the handler's own rejection path was reached.
      expect(body.error?.code).toBe('INVALID_PASSWORD');
    });
  });

  describe('POST /api/setup/first-system-admin/:id (CSRF-exempt)', () => {
    it('does NOT return CSRF_ERROR when called without an x-csrf-token header', async () => {
      // No session, no CSRF token, no setup secret. The endpoint will
      // reject for some other reason (forbidden / admin-exists / unset
      // secret), but the CSRF gate must let it through — that's the
      // point of the exempt entry.
      const { status, body } = await rawRequest(
        '/api/setup/first-system-admin/999999999',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      expect(body.error?.code).not.toBe('CSRF_ERROR');
      // Defensive: make sure we got a response from the route handler
      // (or its auth gate) rather than the CSRF middleware short-circuit.
      expect([400, 401, 403, 404, 409, 500]).toContain(status);
    });
  });
});
