/**
 * End-to-end regression test for task #300: a user can clear their
 * phone number from the profile page by submitting an explicit `null`,
 * and an omitted phone field still leaves the column untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import { users, organizations } from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import { apiPatch, login, type AuthSession } from '../helpers';

const createdUserIds: number[] = [];
const createdOrgIds: number[] = [];

const TEST_PASSWORD = 'PhoneClearTest!2026';
const ORG_SLUG = `pc-${Date.now().toString(36)}`;

let testOrgId: number;

function uniq(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqEmail(prefix: string): string {
  return `${uniq(prefix)}@vitest.local`;
}

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({ name: `phone-clear-test-${ORG_SLUG}`, slug: `phone-clear-test-${ORG_SLUG}` })
    .returning();
  testOrgId = org.id;
  createdOrgIds.push(org.id);
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
  if (createdOrgIds.length > 0) {
    await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
    createdOrgIds.length = 0;
  }
});

async function createUserWithPhoneAndLogin(initialPhone: string | null): Promise<{
  userId: number;
  session: AuthSession;
}> {
  const email = uniqEmail('pc');
  const password = await hashPassword(TEST_PASSWORD);
  const [user] = await db
    .insert(users)
    .values({
      email,
      password,
      name: uniq('Phone Clear User'),
      phone: initialPhone,
      role: 'user',
      organizationId: testOrgId,
    })
    .returning();
  createdUserIds.push(user.id);
  const session = await login(email, TEST_PASSWORD);
  return { userId: user.id, session };
}

describe('PATCH /api/account/profile/:id phone clearing', () => {
  it('writes phone = NULL when the client submits explicit null', async () => {
    const { userId, session } = await createUserWithPhoneAndLogin('+15555550100');

    const before = await db.select().from(users).where(eq(users.id, userId));
    expect(before[0].phone).toBe('+15555550100');

    const res = await apiPatch(`/api/account/profile/${userId}`, { phone: null }, session);
    expect(res.status).toBe(200);

    const after = await db.select().from(users).where(eq(users.id, userId));
    expect(after[0].phone).toBeNull();
  });

  it('leaves phone untouched when the field is omitted from the payload', async () => {
    const { userId, session } = await createUserWithPhoneAndLogin('+15555550101');

    // Send a name-only edit — phone field absent from the body.
    const res = await apiPatch(
      `/api/account/profile/${userId}`,
      { name: 'New Name Only' },
      session,
    );
    expect(res.status).toBe(200);

    const after = await db.select().from(users).where(eq(users.id, userId));
    expect(after[0].phone).toBe('+15555550101');
    expect(after[0].name).toBe('New Name Only');
  });

  it('overwrites phone when the client submits a new string', async () => {
    const { userId, session } = await createUserWithPhoneAndLogin('+15555550102');

    const res = await apiPatch(
      `/api/account/profile/${userId}`,
      { phone: '+15555550999' },
      session,
    );
    expect(res.status).toBe(200);

    const after = await db.select().from(users).where(eq(users.id, userId));
    expect(after[0].phone).toBe('+15555550999');
  });

  it('still clears phone when the user already had no phone on file (idempotent)', async () => {
    const { userId, session } = await createUserWithPhoneAndLogin(null);

    const res = await apiPatch(`/api/account/profile/${userId}`, { phone: null }, session);
    expect(res.status).toBe(200);

    const after = await db.select().from(users).where(eq(users.id, userId));
    expect(after[0].phone).toBeNull();
  });
});
