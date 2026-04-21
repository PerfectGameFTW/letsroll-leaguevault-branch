/**
 * Regression guards for the payments-provider router (task #244).
 *
 * The router at `server/routes/payments-provider/index.ts` composes several
 * focused sub-routers and applies a single shared `requireAuthenticated`
 * gate, plus per-route admin checks and a per-IP rate limiter on
 * `POST /payments`. None of that is enforced by the type system: a careless
 * refactor could drop the `router.use(requireAuthenticated)` line, omit
 * `paymentLimiter` from the charge route, or strip the admin check off
 * `/payments/:id/verify` and nothing would notice. These tests pin down
 * that contract from the outside.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  login,
  apiGet,
  apiPost,
  BASE_URL,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
  type AuthSession,
} from '../helpers';

describe('payments-provider router guards', () => {
  describe('auth gate (composed router-level requireAuthenticated)', () => {
    it('rejects unauthenticated GET /api/payments-provider/config', async () => {
      const { status, data } = await apiGet('/api/payments-provider/config');
      expect(status).toBe(401);
      expect(data.success).toBe(false);
    });

    it('rejects unauthenticated GET /api/payments-provider/catalog/items', async () => {
      const { status, data } = await apiGet('/api/payments-provider/catalog/items');
      expect(status).toBe(401);
      expect(data.success).toBe(false);
    });

    it('rejects unauthenticated GET /api/payments-provider/cards/:bowlerId', async () => {
      const { status, data } = await apiGet('/api/payments-provider/cards/1');
      expect(status).toBe(401);
      expect(data.success).toBe(false);
    });
  });

  describe('admin-only verify endpoint', () => {
    let orgAdmin: AuthSession;

    beforeAll(async () => {
      orgAdmin = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
      // Sanity check: this account is intentionally NOT a system_admin/admin
      // so it must be rejected by the verify endpoint's role check.
      expect(orgAdmin.user.role).not.toBe('system_admin');
      expect(orgAdmin.user.role).not.toBe('admin');
    });

    it('returns 403 for a non-admin authenticated caller', async () => {
      // The role check runs before any DB lookup, so the payment id is
      // irrelevant — we just need to prove the gate is in place.
      const { status, data } = await apiGet(
        '/api/payments-provider/payments/1/verify',
        orgAdmin,
      );
      expect(status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('FORBIDDEN');
    });
  });

  describe('paymentLimiter on POST /payments', () => {
    it('rejects a tight burst from one IP with HTTP 429', async () => {
      // The limiter is configured at max=20 per 15 minutes per IP. We fire
      // a burst that comfortably exceeds that cap and require at least one
      // 429 response. We deliberately send an empty body so any request
      // that *does* get past the limiter fails fast at validation (400)
      // without touching the payment provider.
      const sysAdmin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);

      const burst = 30;
      const statuses: number[] = [];
      for (let i = 0; i < burst; i++) {
        const { status } = await apiPost(
          '/api/payments-provider/payments',
          {},
          sysAdmin,
        );
        statuses.push(status);
        if (status === 429) break;
      }

      expect(statuses).toContain(429);
    }, 30_000);
  });
});
