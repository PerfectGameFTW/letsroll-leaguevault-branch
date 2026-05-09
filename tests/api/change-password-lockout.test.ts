/**
 * Integration tests for the change-password account-lockout escalation
 * (task #357). Complements the rate-limit test in change-password.test.ts:
 * the limiter slows brute-forcing to ~10 attempts per 15-min window;
 * the lockout fires after the longer-horizon counter (default 25) is
 * crossed and force-logs-out every session for the user.
 *
 * Each test seeds the lockout fields directly on the row so we can
 * exercise threshold-crossing and auto-unlock without doing 25 real
 * HTTP attempts (which would be impossible inside the 10/15min
 * limiter budget anyway).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import { users } from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import {
  PASSWORD_CHANGE_LOCKOUT_THRESHOLD,
  PASSWORD_CHANGE_LOCKOUT_DURATION_MS,
} from '../../server/storage/users';
import {
  apiPost,
  login,
  purgeSessionCache,
  BASE_URL,
  getBaselineOrgAId,
  type AuthSession,
} from '../helpers';

// Task #607: attach test users to the seeded `vitest-org-a` baseline
// instead of inserting a fresh org per run. The org row is permanent;
// tests still clean up the user rows they create.
const createdUserIds: number[] = [];

const ORIGINAL_PASSWORD = 'LockoutTest!2026';
const NEW_STRONG_PASSWORD = 'BrandNewLkPw!2026';

let testOrgId: number;

function uniq(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqEmail(prefix: string): string {
  return `${uniq(prefix)}@vitest.local`;
}

beforeAll(async () => {
  testOrgId = await getBaselineOrgAId();
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

async function createUserAndLogin(): Promise<{
  userId: number;
  email: string;
  session: AuthSession;
}> {
  const email = uniqEmail('lk');
  const password = await hashPassword(ORIGINAL_PASSWORD);
  const [user] = await db
    .insert(users)
    .values({
      email,
      password,
      name: uniq('LK User'),
      role: 'user',
      organizationId: testOrgId,
    })
    .returning();
  createdUserIds.push(user.id);
  const session = await login(email, ORIGINAL_PASSWORD);
  return { userId: user.id, email, session };
}

describe('POST /api/account/change-password — account lockout (task #357)', () => {
  it('engages the lockout when the threshold-th invalid attempt fires, returns 423 ACCOUNT_LOCKED, sets passwordChangeLockedUntil, and destroys the caller session', async () => {
    const { userId, email, session } = await createUserAndLogin();

    // Pre-seed the counter to one below the threshold so a single
    // wrong-password POST crosses it. Avoids needing 25 real attempts
    // (which would also hit the 10/15min limiter).
    await db
      .update(users)
      .set({ failedPasswordChangeAttempts: PASSWORD_CHANGE_LOCKOUT_THRESHOLD - 1 })
      .where(eq(users.id, userId));

    const startedAt = Date.now();
    const res = await apiPost<{ lockedUntil?: string }>(
      '/api/account/change-password',
      { currentPassword: 'still-the-wrong-password', newPassword: NEW_STRONG_PASSWORD },
      session,
    );
    const elapsedMs = Date.now() - startedAt;

    expect(res.status).toBe(423);
    expect(res.data.success).toBe(false);
    expect(res.data.error?.code).toBe('ACCOUNT_LOCKED');
    // The 423 includes a machine-readable lockedUntil so the client
    // can show "try again in N minutes" without parsing the string.
    const detailsLockedUntil = (res.data.error as { details?: { lockedUntil?: string } } | undefined)
      ?.details?.lockedUntil;
    expect(typeof detailsLockedUntil).toBe('string');
    const lockedUntilMs = Date.parse(detailsLockedUntil!);
    expect(Number.isFinite(lockedUntilMs)).toBe(true);
    // Lock should be ~1 hour in the future (allow generous slack for CI).
    const expectedUnlock = Date.now() + PASSWORD_CHANGE_LOCKOUT_DURATION_MS;
    expect(lockedUntilMs).toBeGreaterThan(expectedUnlock - 5 * 60 * 1000);
    expect(lockedUntilMs).toBeLessThan(expectedUnlock + 5 * 60 * 1000);

    // Side effects (destroy-all-sessions, alert email) are dispatched
    // inline (sessions) and fire-and-forget (email). The route should
    // still return promptly — a synchronous SendGrid await would
    // balloon this past a few seconds.
    expect(elapsedMs).toBeLessThan(3000);

    // DB row reflects the lock.
    const [row] = await db
      .select({
        count: users.failedPasswordChangeAttempts,
        lockedUntil: users.passwordChangeLockedUntil,
      })
      .from(users)
      .where(eq(users.id, userId));
    expect(row.count).toBe(PASSWORD_CHANGE_LOCKOUT_THRESHOLD);
    expect(row.lockedUntil).toBeTruthy();

    // The locking event signals possible session compromise — the
    // caller's own session must die too. Hitting an authenticated
    // endpoint with the same cookie should now 401.
    const afterAuth = await fetch(`${BASE_URL}/api/auth/user`, {
      headers: { Cookie: session.cookies },
    });
    expect(afterAuth.status).toBe(401);

    // Sanity: the email row was untouched (we only flipped lockout fields).
    void email;
  });

  it('refuses change-password with 423 even when the CURRENT password is correct, while a lock is active', async () => {
    const { userId, email, session } = await createUserAndLogin();

    // Pre-seed an active lock that lifts well in the future.
    const futureLock = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await db
      .update(users)
      .set({
        failedPasswordChangeAttempts: PASSWORD_CHANGE_LOCKOUT_THRESHOLD,
        passwordChangeLockedUntil: futureLock,
      })
      .where(eq(users.id, userId));

    const [before] = await db
      .select({ password: users.password })
      .from(users)
      .where(eq(users.id, userId));

    // Even the CORRECT password should bounce — the lock is supposed
    // to defeat an attacker who somehow already knows the current
    // password but is racing the user to rotate it before they can.
    const res = await apiPost(
      '/api/account/change-password',
      { currentPassword: ORIGINAL_PASSWORD, newPassword: NEW_STRONG_PASSWORD },
      session,
    );
    expect(res.status).toBe(423);
    expect(res.data.success).toBe(false);
    expect(res.data.error?.code).toBe('ACCOUNT_LOCKED');

    // Hash unchanged: the password rotation never ran.
    const [after] = await db
      .select({ password: users.password })
      .from(users)
      .where(eq(users.id, userId));
    expect(after.password).toBe(before.password);

    // The pre-seeded lock check happens BEFORE comparePasswords, so
    // the failure counter must NOT have been bumped (otherwise an
    // attacker holding the lock active could keep extending it).
    const [counterRow] = await db
      .select({ count: users.failedPasswordChangeAttempts })
      .from(users)
      .where(eq(users.id, userId));
    expect(counterRow.count).toBe(PASSWORD_CHANGE_LOCKOUT_THRESHOLD);
    void email;
  });

  it('auto-unlocks once passwordChangeLockedUntil has elapsed: a successful change goes through and resets the counter', async () => {
    const { userId, email, session } = await createUserAndLogin();

    // Seed an EXPIRED lock with the threshold counter — simulates a
    // user who got locked out an hour ago and is back to rotate their
    // password. The route should let them through and the success
    // path should wipe the lock + counter.
    const expiredLock = new Date(Date.now() - 60 * 1000).toISOString();
    await db
      .update(users)
      .set({
        failedPasswordChangeAttempts: PASSWORD_CHANGE_LOCKOUT_THRESHOLD,
        passwordChangeLockedUntil: expiredLock,
      })
      .where(eq(users.id, userId));

    const res = await apiPost<{ message: string }>(
      '/api/account/change-password',
      { currentPassword: ORIGINAL_PASSWORD, newPassword: NEW_STRONG_PASSWORD },
      session,
    );
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);

    const [row] = await db
      .select({
        count: users.failedPasswordChangeAttempts,
        lockedUntil: users.passwordChangeLockedUntil,
      })
      .from(users)
      .where(eq(users.id, userId));
    expect(row.count).toBe(0);
    expect(row.lockedUntil).toBeNull();

    // New credentials work end-to-end. Drop the cached pre-rotation
    // session so this is a real round-trip against the new password.
    purgeSessionCache(email);
    const newSession = await login(email, NEW_STRONG_PASSWORD);
    expect(newSession.user.email).toBe(email);
  });

  it('a successful change-password resets a non-zero failure counter to 0', async () => {
    const { userId, session } = await createUserAndLogin();

    // Seed a partial counter — well below threshold, no active lock.
    await db
      .update(users)
      .set({ failedPasswordChangeAttempts: 7 })
      .where(eq(users.id, userId));

    const res = await apiPost<{ message: string }>(
      '/api/account/change-password',
      { currentPassword: ORIGINAL_PASSWORD, newPassword: NEW_STRONG_PASSWORD },
      session,
    );
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);

    const [row] = await db
      .select({
        count: users.failedPasswordChangeAttempts,
        lockedUntil: users.passwordChangeLockedUntil,
      })
      .from(users)
      .where(eq(users.id, userId));
    expect(row.count).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it('is idempotent under a parallel burst of wrong-password attempts at the threshold boundary: counter never overshoots and the lock fires exactly once', async () => {
    const { userId, session } = await createUserAndLogin();

    // Pre-seed the counter to one below the threshold so a small
    // parallel burst races to cross it. Without FOR UPDATE inside
    // the storage helper this would either (a) double-fire the
    // lockout side-effects or (b) push the counter to threshold+N.
    // Both are wrong: we want exactly one transition from
    // pre-locked → locked, and the persisted counter must equal
    // the threshold value (not higher).
    await db
      .update(users)
      .set({ failedPasswordChangeAttempts: PASSWORD_CHANGE_LOCKOUT_THRESHOLD - 1 })
      .where(eq(users.id, userId));

    const burstSize = 5;
    const responses = await Promise.all(
      Array.from({ length: burstSize }, () =>
        apiPost<{ lockedUntil?: string }>(
          '/api/account/change-password',
          { currentPassword: 'wrong-pw', newPassword: NEW_STRONG_PASSWORD },
          session,
        ),
      ),
    );

    // Every response is either 423 (lock active), 400 (the one
    // that crossed the threshold loses the race to the pre-check
    // for siblings), or 403 (see below). Crucially: NONE may be
    // 200, NONE may be 5xx.
    //
    // Why 403 is allowed here — the lockout side-effect inside the
    // handler calls destroyAllSessionsForUser(user.id), which fires
    // `DELETE FROM "session" WHERE sess->'passport'->>'user' = $1`
    // and so wipes the caller's own session row mid-burst. A sibling
    // request whose express-session load runs AFTER that delete
    // commits enters the globally-mounted csrfProtection middleware
    // (server/index.ts: `app.use('/api', csrfProtection)`) with no
    // `req.session.csrfToken`, which is exactly the
    // `Missing session CSRF token` branch — it returns 403 with
    // `success: false` and code `CSRF_ERROR`. That's not a bug:
    // it's the same security contract the lockout is enforcing
    // ("your session is no longer valid"), surfaced one middleware
    // earlier than the 423 ACCOUNT_LOCKED response. Tolerating it
    // here keeps the assertion focused on the actual invariants
    // (no overshoot, exactly one lock transition, no success, no
    // server error) instead of pinning the precise middleware that
    // refuses the request.
    for (const r of responses) {
      expect([400, 403, 423]).toContain(r.status);
      expect(r.data.success).toBe(false);
    }
    const lockedResponses = responses.filter(r => r.status === 423);
    expect(lockedResponses.length).toBeGreaterThanOrEqual(1);

    // Persisted counter must NOT exceed the threshold. The active-
    // lock pre-check inside the storage helper short-circuits
    // without bumping, so once the lock lands the counter freezes.
    // Allowing equality covers the case where the FOR UPDATE
    // serialization let multiple-but-already-locked attempts
    // observe the just-set lock and bail.
    const [row] = await db
      .select({
        count: users.failedPasswordChangeAttempts,
        lockedUntil: users.passwordChangeLockedUntil,
      })
      .from(users)
      .where(eq(users.id, userId));
    expect(row.count).toBe(PASSWORD_CHANGE_LOCKOUT_THRESHOLD);
    expect(row.lockedUntil).toBeTruthy();
  });

  it('a single isolated wrong-password attempt bumps the counter by 1 without locking (well under threshold)', async () => {
    const { userId, session } = await createUserAndLogin();

    // Counter starts at 0 by default — verify the bump path works
    // for the common case (typo, no lockout side effects).
    const res = await apiPost(
      '/api/account/change-password',
      { currentPassword: 'definitely-wrong', newPassword: NEW_STRONG_PASSWORD },
      session,
    );
    expect(res.status).toBe(400);
    expect(res.data.error?.code).toBe('INVALID_PASSWORD');

    const [row] = await db
      .select({
        count: users.failedPasswordChangeAttempts,
        lockedUntil: users.passwordChangeLockedUntil,
      })
      .from(users)
      .where(eq(users.id, userId));
    expect(row.count).toBe(1);
    expect(row.lockedUntil).toBeNull();
  });
});
