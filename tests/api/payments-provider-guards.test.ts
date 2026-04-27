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
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import { users } from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
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

    // Task #311 — the Apple Pay sub-router lives at the same mount point
    // (`server/routes/payments-provider/apple-pay.ts`) and inherits the
    // shared `requireAuthenticated` gate composed in
    // `payments-provider/index.ts`. Without explicit coverage, a future
    // refactor that mounts apple-pay separately or before the gate would
    // silently expose Apple Pay job controls and recovery-alert reads
    // to anonymous callers.
    //
    // We pin two representative GETs from the sub-router (a list and a
    // detail variant) so reordering or re-mounting fails here. POSTs are
    // intentionally not used as auth-gate probes: the global CSRF
    // middleware mounted at `app.use('/api', csrfProtection)` runs
    // before the router-level auth gate and returns 403 on unauth POSTs,
    // which would mask whether the auth gate itself is in place.
    it('rejects unauthenticated GET /api/payments-provider/apple-pay/jobs', async () => {
      const { status, data } = await apiGet('/api/payments-provider/apple-pay/jobs');
      expect(status).toBe(401);
      expect(data.success).toBe(false);
    });

    it('rejects unauthenticated GET /api/payments-provider/apple-pay/recovery-alerts/recent', async () => {
      const { status, data } = await apiGet(
        '/api/payments-provider/apple-pay/recovery-alerts/recent',
      );
      expect(status).toBe(401);
      expect(data.success).toBe(false);
    });
  });

  describe('admin-only verify endpoint', () => {
    let nonAdmin: AuthSession;
    const createdNonAdminUserIds: number[] = [];

    beforeAll(async () => {
      // The verify route allows BOTH `system_admin` and `org_admin`
      // (see `payments-provider/charges.ts`), so the existing
      // TEST_ORG_A account — which is `org_admin` — would pass the
      // gate and fall through to a 404 NOT_FOUND for the placeholder
      // payment id. To exercise the actual 403 branch we need a
      // role that is neither admin variant. Seed a throwaway
      // `role: 'user'` account scoped to org A and log in as them.
      const orgAdminSession = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
      const orgId = orgAdminSession.user.organizationId;
      expect(orgId).toBeTruthy();

      const password = 'vitest-payments-provider-guards-pw';
      const passwordHash = await hashPassword(password);
      const email = `vitest-pp-nonadmin-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@vitest.local`;
      const [row] = await db
        .insert(users)
        .values({
          email,
          password: passwordHash,
          name: 'Vitest Non-Admin (payments-provider guards)',
          role: 'user',
          organizationId: orgId,
        })
        .returning({ id: users.id });
      createdNonAdminUserIds.push(row.id);

      nonAdmin = await login(email, password);
      // Sanity check: this account is intentionally neither
      // system_admin nor org_admin so the verify gate must reject it.
      expect(nonAdmin.user.role).not.toBe('system_admin');
      expect(nonAdmin.user.role).not.toBe('org_admin');
    });

    afterAll(async () => {
      if (createdNonAdminUserIds.length > 0) {
        await db.delete(users).where(inArray(users.id, createdNonAdminUserIds));
        createdNonAdminUserIds.length = 0;
      }
    });

    it('returns 403 for a non-admin authenticated caller', async () => {
      // The role check runs before any DB lookup, so the payment id is
      // irrelevant — we just need to prove the gate is in place.
      const { status, data } = await apiGet(
        '/api/payments-provider/payments/1/verify',
        nonAdmin,
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
