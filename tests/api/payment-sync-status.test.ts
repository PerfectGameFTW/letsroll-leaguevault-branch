/**
 * Integration tests for payment-customer sync status surfacing (task #281).
 *
 * Verifies:
 *   - PATCH /api/account/profile/:id includes paymentSyncStatus in the response
 *   - Status is 'not_applicable' when the user has no linked bowler
 *   - POST /api/account/bowlers/:id/retry-payment-sync requires system_admin
 *   - Retry endpoint returns 404 for a missing bowler
 *   - Retry endpoint returns 422 when the bowler has no linked user
 */
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import { users, bowlers, organizations } from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import {
  apiPatch,
  apiPost,
  login,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

const createdUserIds: number[] = [];
const createdBowlerIds: number[] = [];
const createdOrgIds: number[] = [];

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
  if (createdBowlerIds.length > 0) {
    await db.delete(bowlers).where(inArray(bowlers.id, createdBowlerIds));
    createdBowlerIds.length = 0;
  }
  if (createdOrgIds.length > 0) {
    await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
    createdOrgIds.length = 0;
  }
});

function uniq(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('PATCH /api/account/profile/:id payment sync status', () => {
  it('returns paymentSyncStatus: not_applicable for a user without a linked bowler', async () => {
    // Org admin in test data does not have a linked bowler row
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    expect(session.user.id).toBeGreaterThan(0);

    const res = await apiPatch<{ paymentSyncStatus: string; name: string }>(
      `/api/account/profile/${session.user.id}`,
      { name: session.user.name }, // no-op change
      session,
    );

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data?.paymentSyncStatus).toBe('not_applicable');
  });
});

describe('POST /api/account/bowlers/:id/retry-payment-sync', () => {
  it('rejects unauthenticated callers (401 auth or 403 CSRF)', async () => {
    const res = await apiPost(`/api/account/bowlers/1/retry-payment-sync`, {});
    // CSRF runs before auth, so anonymous calls fail at the CSRF layer
    expect([401, 403]).toContain(res.status);
  });

  it('rejects org_admin callers with 403', async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const res = await apiPost(
      `/api/account/bowlers/1/retry-payment-sync`,
      {},
      session,
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when bowler does not exist', async () => {
    const admin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const res = await apiPost(
      `/api/account/bowlers/99999999/retry-payment-sync`,
      {},
      admin,
    );
    expect(res.status).toBe(404);
    expect(res.data.error?.code).toBe('NOT_FOUND');
  });

  it('returns 422 when the bowler has no linked user', async () => {
    const admin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);

    // Create an isolated bowler with no linked user
    const [bowler] = await db
      .insert(bowlers)
      .values({
        name: uniq('test-bowler'),
        email: `${uniq('b')}@vitest.local`,
        active: true,
        order: 0,
      } as any)
      .returning();
    createdBowlerIds.push(bowler.id);

    const res = await apiPost(
      `/api/account/bowlers/${bowler.id}/retry-payment-sync`,
      {},
      admin,
    );
    expect(res.status).toBe(422);
    expect(res.data.error?.code).toBe('NO_LINKED_USER');
  });
});
