/**
 * Integration tests for the email-change confirmation flow (task #280).
 *
 * Verifies:
 *   - PATCH /api/account/profile/:id with a new email does NOT immediately
 *     change the login email, returns emailChangeRequested:true, and creates
 *     a pending request row.
 *   - Name/phone updates remain synchronous.
 *   - POST /api/account/confirm-email-change with a valid token swaps the
 *     login email and consumes the token.
 *   - Reusing a consumed token is rejected.
 *   - Expired tokens are rejected.
 *   - Two competing requests: the first is invalidated when the second is
 *     created.
 *   - Email-already-in-use at confirm time is rejected with 400.
 *   - Changing password invalidates pending email-change requests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../server/db';
import { storage } from '../../server/storage';
import { users, organizations, emailChangeRequests } from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import { createHash } from 'crypto';
import {
  apiPatch,
  apiPost,
  login,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
  type AuthSession,
} from '../helpers';

const createdUserIds: number[] = [];
const createdOrgIds: number[] = [];

const TEST_PASSWORD = 'EmailChangeTest!2026';
const ORG_SLUG = `ec-${Date.now().toString(36)}`;

let testOrgId: number;

function uniq(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqEmail(prefix: string): string {
  return `${uniq(prefix)}@vitest.local`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({ name: `email-change-test-${ORG_SLUG}`, slug: `email-change-test-${ORG_SLUG}` })
    .returning();
  testOrgId = org.id;
  createdOrgIds.push(org.id);
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    // email_change_requests rows cascade-delete with the user
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
  if (createdOrgIds.length > 0) {
    await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
    createdOrgIds.length = 0;
  }
});

async function createUserAndLogin(): Promise<{
  userId: number;
  oldEmail: string;
  session: AuthSession;
}> {
  const oldEmail = uniqEmail('old');
  const password = await hashPassword(TEST_PASSWORD);
  const [user] = await db
    .insert(users)
    .values({
      email: oldEmail,
      password,
      name: uniq('Test User'),
      role: 'user',
      organizationId: testOrgId,
    })
    .returning();
  createdUserIds.push(user.id);
  const session = await login(oldEmail, TEST_PASSWORD);
  return { userId: user.id, oldEmail, session };
}

describe('PATCH /api/account/profile/:id with email change', () => {
  it('does not change the login email immediately and creates a pending request', async () => {
    const { userId, oldEmail, session } = await createUserAndLogin();
    const newEmail = uniqEmail('new');

    const res = await apiPatch<{
      email: string;
      emailChangeRequested: boolean;
      paymentSyncStatus: string;
    }>(`/api/account/profile/${userId}`, { email: newEmail }, session);

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data?.emailChangeRequested).toBe(true);
    // Returned record still shows the OLD email — login has not changed.
    expect(res.data.data?.email).toBe(oldEmail);

    // DB user row still has the old email.
    const [reread] = await db.select().from(users).where(eq(users.id, userId));
    expect(reread.email).toBe(oldEmail);

    // Exactly one pending request row exists for this user.
    const pending = await db
      .select()
      .from(emailChangeRequests)
      .where(eq(emailChangeRequests.userId, userId));
    const open = pending.filter(r => r.consumedAt === null);
    expect(open.length).toBe(1);
    expect(open[0].newEmail).toBe(newEmail);
  });

  it('still updates name synchronously even when email is also changed', async () => {
    const { userId, session } = await createUserAndLogin();
    const newEmail = uniqEmail('new');
    const newName = `Renamed ${Date.now()}`;

    const res = await apiPatch<{ name: string; emailChangeRequested: boolean }>(
      `/api/account/profile/${userId}`,
      { email: newEmail, name: newName },
      session,
    );

    expect(res.status).toBe(200);
    expect(res.data.data?.emailChangeRequested).toBe(true);
    expect(res.data.data?.name).toBe(newName);

    const [reread] = await db.select().from(users).where(eq(users.id, userId));
    expect(reread.name).toBe(newName);
  });

  it('returns emailChangeRequested:false when the submitted email matches the current one', async () => {
    const { userId, oldEmail, session } = await createUserAndLogin();

    const res = await apiPatch<{ emailChangeRequested: boolean }>(
      `/api/account/profile/${userId}`,
      { email: oldEmail },
      session,
    );

    expect(res.status).toBe(200);
    expect(res.data.data?.emailChangeRequested).toBe(false);
  });

  it('rejects when the new email is already used by a different user', async () => {
    const { userId, session } = await createUserAndLogin();
    const taken = uniqEmail('taken');
    const password = await hashPassword(TEST_PASSWORD);
    const [other] = await db
      .insert(users)
      .values({
        email: taken,
        password,
        name: uniq('Other'),
        role: 'user',
        organizationId: testOrgId,
      })
      .returning();
    createdUserIds.push(other.id);

    const res = await apiPatch(`/api/account/profile/${userId}`, { email: taken }, session);
    expect(res.status).toBe(400);
    expect(res.data.error?.code).toBe('EMAIL_IN_USE');
  });

  it('two competing requests: creating a second invalidates the first', async () => {
    const { userId, session } = await createUserAndLogin();
    const firstEmail = uniqEmail('first');
    const secondEmail = uniqEmail('second');

    await apiPatch(`/api/account/profile/${userId}`, { email: firstEmail }, session);
    await apiPatch(`/api/account/profile/${userId}`, { email: secondEmail }, session);

    const rows = await db
      .select()
      .from(emailChangeRequests)
      .where(eq(emailChangeRequests.userId, userId));
    const open = rows.filter(r => r.consumedAt === null);
    expect(open.length).toBe(1);
    expect(open[0].newEmail).toBe(secondEmail);
  });
});

describe('POST /api/account/confirm-email-change', () => {
  it('happy path: a valid token swaps the email and consumes the token', async () => {
    const { userId, session } = await createUserAndLogin();
    const newEmail = uniqEmail('new');

    // Patch raw token directly into the DB so the test can read it back —
    // production tokens go out only by email, but here we synthesize one.
    const rawToken = `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await db.insert(emailChangeRequests).values({
      userId,
      newEmail,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await apiPost<{ email: string; paymentSyncStatus: string }>(
      `/api/account/confirm-email-change`,
      { token: rawToken },
      session,
    );
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data?.email).toBe(newEmail);

    const [reread] = await db.select().from(users).where(eq(users.id, userId));
    expect(reread.email).toBe(newEmail);

    const [request] = await db
      .select()
      .from(emailChangeRequests)
      .where(eq(emailChangeRequests.tokenHash, hashToken(rawToken)));
    expect(request.consumedAt).not.toBeNull();
  });

  it('rejects an already-consumed token', async () => {
    const { userId, session } = await createUserAndLogin();
    const newEmail = uniqEmail('new');
    const rawToken = `reuse-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    await db.insert(emailChangeRequests).values({
      userId,
      newEmail,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const first = await apiPost(`/api/account/confirm-email-change`, { token: rawToken }, session);
    expect(first.status).toBe(200);

    const second = await apiPost(`/api/account/confirm-email-change`, { token: rawToken }, session);
    expect(second.status).toBe(400);
    expect(second.data.error?.code).toBe('TOKEN_CONSUMED');
  });

  it('rejects an expired token', async () => {
    const { userId, session } = await createUserAndLogin();
    const newEmail = uniqEmail('new');
    const rawToken = `expired-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    await db.insert(emailChangeRequests).values({
      userId,
      newEmail,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const res = await apiPost(`/api/account/confirm-email-change`, { token: rawToken }, session);
    expect(res.status).toBe(400);
    expect(res.data.error?.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a bogus token (400 INVALID_TOKEN, or 403 from the CSRF gate when called anonymously)', async () => {
    // Anonymous callers hit the CSRF middleware first (which is correct —
    // the confirm link is normally clicked from a frontend page that
    // attaches the user's CSRF token). When they DO attach a session, the
    // token-validity check returns INVALID_TOKEN.
    const { session } = await createUserAndLogin();
    const res = await apiPost(
      `/api/account/confirm-email-change`,
      { token: 'never-issued-deadbeef' },
      session,
    );
    expect(res.status).toBe(400);
    expect(res.data.error?.code).toBe('INVALID_TOKEN');

    const anon = await apiPost(`/api/account/confirm-email-change`, {
      token: 'never-issued-deadbeef',
    });
    expect([400, 403]).toContain(anon.status);
  });

  it('rejects when the target email was claimed between request and confirm', async () => {
    const { userId, oldEmail, session } = await createUserAndLogin();
    const requestedEmail = uniqEmail('requested');
    const rawToken = `race-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    await db.insert(emailChangeRequests).values({
      userId,
      newEmail: requestedEmail,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // Race: another user grabs the address before the original confirms.
    const password = await hashPassword(TEST_PASSWORD);
    const [other] = await db
      .insert(users)
      .values({
        email: requestedEmail,
        password,
        name: uniq('Squatter'),
        role: 'user',
        organizationId: testOrgId,
      })
      .returning();
    createdUserIds.push(other.id);

    const res = await apiPost(`/api/account/confirm-email-change`, { token: rawToken }, session);
    expect(res.status).toBe(400);
    expect(res.data.error?.code).toBe('EMAIL_IN_USE');

    // Original user's email must remain unchanged.
    const [reread] = await db.select().from(users).where(eq(users.id, userId));
    expect(reread.email).toBe(oldEmail);

    // Token consumed so a refresh doesn't loop on the same race.
    const [request] = await db
      .select()
      .from(emailChangeRequests)
      .where(eq(emailChangeRequests.tokenHash, hashToken(rawToken)));
    expect(request.consumedAt).not.toBeNull();
  });
});

describe('POST /api/account/change-password invalidates pending email-change requests', () => {
  it('marks open email-change requests as consumed after a successful password change', async () => {
    const { userId, session } = await createUserAndLogin();
    const newEmail = uniqEmail('pending');
    const rawToken = `pwchange-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    await db.insert(emailChangeRequests).values({
      userId,
      newEmail,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await apiPost(
      `/api/account/change-password`,
      { currentPassword: TEST_PASSWORD, newPassword: 'NewPassword!2026XX' },
      session,
    );
    expect(res.status).toBe(200);

    // The previously-issued token should now be useless.
    const confirmRes = await apiPost(
      `/api/account/confirm-email-change`,
      { token: rawToken },
      session,
    );
    expect(confirmRes.status).toBe(400);
    expect(confirmRes.data.error?.code).toBe('TOKEN_CONSUMED');
  });
});

describe('POST /api/auth/set-password invalidates pending email-change requests', () => {
  it('marks open email-change requests as consumed after a successful password reset', async () => {
    const { userId } = await createUserAndLogin();
    const newEmail = uniqEmail('pending-reset');
    const rawToken = `setpw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // Stage an invite/reset token on the user, then a pending email-change.
    const inviteToken = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await storage.setUserInviteToken(
      userId,
      inviteToken,
      new Date(Date.now() + 60_000),
    );
    await db.insert(emailChangeRequests).values({
      userId,
      newEmail,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const setRes = await apiPost(`/api/auth/set-password`, {
      token: inviteToken,
      password: 'AfterReset!2026XX',
    });
    expect(setRes.status).toBe(200);

    // Pending token from before the reset must no longer work.
    const { session } = await createUserAndLogin();
    const confirmRes = await apiPost(
      `/api/account/confirm-email-change`,
      { token: rawToken },
      session,
    );
    expect(confirmRes.status).toBe(400);
    expect(confirmRes.data.error?.code).toBe('TOKEN_CONSUMED');
  });
});

// Quiet a TS warning when sql is imported but only sometimes used in future edits.
void sql;
