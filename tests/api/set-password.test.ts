/**
 * Integration tests for POST /api/auth/set-password.
 *
 * Task #352 extends the change-password (#318) "force-log-out other
 * sessions" defense to the unauthenticated reset / set-password flow.
 * The user clicking a reset link is overwhelmingly likely to be doing
 * so because they suspect compromise, so any leftover session for
 * that user must die — not just "all other sessions besides the
 * caller's", since the caller has no current session here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import { users, organizations } from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import { storage } from '../../server/storage';
import { login, BASE_URL, type AuthSession } from '../helpers';

const ORIGINAL_PASSWORD = 'SetPwTest!2026';
const NEW_PASSWORD = 'BrandNewSetPw!2026XX';
const ORG_SLUG = `sp-${Date.now().toString(36)}`;

const createdUserIds: number[] = [];
const createdOrgIds: number[] = [];

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
    .values({ name: `set-password-test-${ORG_SLUG}`, slug: `set-password-test-${ORG_SLUG}` })
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

async function createUserWithPassword(): Promise<{ userId: number; email: string }> {
  const email = uniqEmail('sp');
  const password = await hashPassword(ORIGINAL_PASSWORD);
  const [user] = await db
    .insert(users)
    .values({
      email,
      password,
      name: uniq('SP User'),
      role: 'user',
      organizationId: testOrgId,
    })
    .returning();
  createdUserIds.push(user.id);
  return { userId: user.id, email };
}

async function loggedInSession(email: string): Promise<AuthSession> {
  return login(email, ORIGINAL_PASSWORD);
}

async function issueResetToken(userId: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 60 * 60 * 1000);
  await storage.setUserInviteToken(userId, token, expiry);
  return token;
}

async function callSetPassword(token: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/auth/set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  return { status: res.status, body: (await res.json()) as { success: boolean } };
}

describe('POST /api/auth/set-password · force-log-out (task #352)', () => {
  it('destroys every existing session for the user after a successful reset', async () => {
    // The user has TWO devices logged in — the laptop they suspect
    // is compromised (sessionA) and the phone they're using to
    // reset (sessionB). They never re-login on either of these
    // sessions; instead they click the reset link in their email,
    // which hits set-password unauthenticated. After the reset,
    // BOTH leftover sessions must be dead.
    const { userId, email } = await createUserWithPassword();
    const sessionA = await loggedInSession(email);
    const sessionB = await loggedInSession(email);

    // Sanity: both are live before the reset.
    for (const s of [sessionA, sessionB]) {
      const r = await fetch(`${BASE_URL}/api/auth/user`, { headers: { Cookie: s.cookies } });
      expect(r.status).toBe(200);
    }

    const token = await issueResetToken(userId);
    const reset = await callSetPassword(token, NEW_PASSWORD);
    expect(reset.status).toBe(200);
    expect(reset.body.success).toBe(true);

    // Both pre-reset sessions must now be invalidated. This is the
    // load-bearing assertion of #352 — without the
    // destroyOtherSessionsForUser call in the route, sessionA and
    // sessionB would still be honored until their cookies expired.
    for (const s of [sessionA, sessionB]) {
      const r = await fetch(`${BASE_URL}/api/auth/user`, { headers: { Cookie: s.cookies } });
      expect(r.status).toBe(401);
    }

    // The new password actually works (the rotation committed; the
    // session destruction didn't somehow roll it back).
    const newSession = await login(email, NEW_PASSWORD);
    expect(newSession.user.email).toBe(email);
  });

  it('still completes the reset (and returns 200) when the user has no existing sessions', async () => {
    // Pure-happy-path regression guard — destroying zero sessions
    // must not cause the destroy step (or the surrounding handler)
    // to fail. This pins that the count==0 branch is harmless.
    const { userId, email } = await createUserWithPassword();
    const token = await issueResetToken(userId);

    const reset = await callSetPassword(token, NEW_PASSWORD);
    expect(reset.status).toBe(200);
    expect(reset.body.success).toBe(true);

    // Old credentials gone, new credentials work.
    const oldLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: ORIGINAL_PASSWORD }),
    });
    expect(oldLogin.status).toBe(401);

    const newSession = await login(email, NEW_PASSWORD);
    expect(newSession.user.email).toBe(email);
  });
});
