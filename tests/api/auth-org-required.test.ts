/**
 * Integration tests for the `users_role_org_required` invariant at the
 * route layer:
 *   - POST /api/auth/register without an organizationId returns
 *     400 ORG_REQUIRED.
 *   - DELETE /api/org-admin/users/:id/remove (the legacy "remove from
 *     org" path) refuses to leave a non-admin user org-less and returns
 *     400 ORG_REQUIRED.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import { users } from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import {
  apiDelete,
  BASE_URL,
  login,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

const createdUserIds: number[] = [];

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@vitest.local`;
}

async function makeNonAdminUserInOrg(organizationId: number): Promise<number> {
  const password = await hashPassword('vitest-org-required-pw');
  const [row] = await db
    .insert(users)
    .values({
      email: uniqueEmail('member'),
      password,
      name: 'Vitest Member',
      role: 'user',
      organizationId,
    })
    .returning({ id: users.id });
  createdUserIds.push(row.id);
  return row.id;
}

describe('POST /api/auth/register — non-admin org requirement', () => {
  it('returns 400 ORG_REQUIRED when no organizationId is supplied', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail('register-no-org'),
        password: 'CorrectHorseBatteryStaple1!',
        name: 'No Org Sign Up',
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error?.code).toBe('ORG_REQUIRED');
  });

  it('returns 400 ORG_REQUIRED when organizationId is the empty string', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail('register-empty-org'),
        password: 'CorrectHorseBatteryStaple1!',
        name: 'Empty Org Sign Up',
        organizationId: '',
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error?.code).toBe('ORG_REQUIRED');
  });

  it('returns 400 ORG_REQUIRED when organizationId is non-numeric', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail('register-nan-org'),
        password: 'CorrectHorseBatteryStaple1!',
        name: 'NaN Org Sign Up',
        organizationId: 'not-a-number',
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error?.code).toBe('ORG_REQUIRED');
  });
});

describe('DELETE /api/org-admin/users/:id/remove — non-admin org requirement', () => {
  it('returns 400 ORG_REQUIRED when an org_admin tries to remove a regular user from the org', async () => {
    const orgAdminSession = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const orgId = orgAdminSession.user.organizationId;
    expect(orgId).not.toBeNull();
    const memberId = await makeNonAdminUserInOrg(orgId!);

    const { status, data } = await apiDelete(
      `/api/org-admin/users/${memberId}/remove`,
      orgAdminSession,
    );

    expect(status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error?.code).toBe('ORG_REQUIRED');

    // Sanity: the user is still in the org — the endpoint refused to
    // orphan them, it did not silently null the FK.
    const [after] = await db.select().from(users).where(eq(users.id, memberId));
    expect(after?.organizationId).toBe(orgId);
  });

  it('returns 400 ORG_REQUIRED when a system_admin tries to remove a regular user from their org', async () => {
    const sysSession = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    const orgAdminSession = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const orgId = orgAdminSession.user.organizationId!;
    const memberId = await makeNonAdminUserInOrg(orgId);

    const { status, data } = await apiDelete(
      `/api/org-admin/users/${memberId}/remove`,
      sysSession,
    );

    expect(status).toBe(400);
    expect(data.error?.code).toBe('ORG_REQUIRED');

    const [after] = await db.select().from(users).where(eq(users.id, memberId));
    expect(after?.organizationId).toBe(orgId);
  });
});
