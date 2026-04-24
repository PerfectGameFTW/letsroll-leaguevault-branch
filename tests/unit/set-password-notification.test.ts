/**
 * Route-level unit test for the password-reset security email
 * (task #409). The forgot-password flow finishes at the
 * `/api/auth/set-password` token-consumer endpoint, so this is the
 * companion to `tests/unit/change-password-notification.test.ts` —
 * same `sendPasswordChangedNotification` helper, fired AFTER the
 * password row is persisted, with the request's IP / UA reflecting
 * THIS reset call (not the original change-password endpoint).
 *
 * Mounts the real `auth` router on an isolated express app with all
 * external deps mocked so we can deterministically assert the helper
 * is invoked on success and is NOT invoked on validation / token
 * failures.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const FUTURE_EXPIRY = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST_EXPIRY = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const TEST_USER = {
  id: 7777,
  email: 'reset-notify@vitest.local',
  name: 'Reset Notify Tester',
  role: 'user' as const,
  organizationId: 11,
  bowlerId: null,
  password: 'hashed:original',
  inviteToken: 'valid-token-1234',
  inviteTokenExpiry: FUTURE_EXPIRY,
};

// --- Module mocks. Hoisted by vitest. ----------------------------

const mockSendPasswordChangedNotification = vi.fn(async () => true);
const mockSendTemplatedEmail = vi.fn(async () => true);

vi.mock('../../server/services/email.js', () => ({
  sendPasswordChangedNotification: (...a: unknown[]) =>
    mockSendPasswordChangedNotification.apply(null, a as never),
  sendTemplatedEmail: (...a: unknown[]) =>
    mockSendTemplatedEmail.apply(null, a as never),
  getBaseUrl: () => 'https://test.example',
}));

const mockGetUserByInviteToken = vi.fn();
const mockUpdateUser = vi.fn();
const mockClearUserInviteToken = vi.fn(async () => undefined);
const mockInvalidatePending = vi.fn(async () => 0);
const mockGetBowlerByEmailSystemAdmin = vi.fn(async () => undefined);

vi.mock('../../server/storage', () => ({
  storage: {
    getUserByInviteToken: (...a: unknown[]) =>
      mockGetUserByInviteToken.apply(null, a as never),
    updateUser: (...a: unknown[]) => mockUpdateUser.apply(null, a as never),
    clearUserInviteToken: (...a: unknown[]) =>
      mockClearUserInviteToken.apply(null, a as never),
    invalidatePendingEmailChangeRequestsForUser: (...a: unknown[]) =>
      mockInvalidatePending.apply(null, a as never),
    getBowlerByEmailSystemAdmin: (...a: unknown[]) =>
      mockGetBowlerByEmailSystemAdmin.apply(null, a as never),
  },
}));

const mockHashPassword = vi.fn(async (pw: string) => `hashed:${pw}`);
const mockSafeTokenCompare = vi.fn(
  (a: string, b: string) => a === b,
);

vi.mock('../../server/lib/password', () => ({
  hashPassword: (...a: unknown[]) => mockHashPassword.apply(null, a as never),
  safeTokenCompare: (...a: unknown[]) =>
    mockSafeTokenCompare.apply(null, a as never),
}));

// Auth-route module also pulls in passport setup, subdomain middleware,
// CSRF, and config. Stub the parts that would need a real environment.
vi.mock('../../server/auth', () => ({
  setupAuth: () => undefined,
  destroyOtherSessionsForUser: vi.fn(async () => 0),
}));

vi.mock('../../server/middleware/subdomain', () => ({
  checkUserBelongsToOrg: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
}));

vi.mock('../../server/middleware/csrf', () => ({
  csrfProtection: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../../server/config', () => ({
  isDev: false,
}));

// Bypass the per-route rate limiter so we can hammer the same IP
// without tripping the 5/15min cap. Rate-limit behavior is covered
// elsewhere; this test only cares about the email-dispatch wiring.
vi.mock('express-rate-limit', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  ipKeyGenerator: (ip: string) => ip,
}));

// --- Build the test harness. -------------------------------------

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { registerAuthRoutes } = await import('../../server/routes/auth');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'ip', { value: '198.51.100.7', configurable: true });
    // Stand in for passport's `req.login(user, cb)` — the route calls
    // it after a successful set-password to auto-login the caller.
    (req as unknown as { login: (u: unknown, cb: (e: unknown) => void) => void }).login =
      (_u, cb) => cb(null);
    next();
  });
  registerAuthRoutes(app);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  mockSendPasswordChangedNotification.mockClear();
  mockSendPasswordChangedNotification.mockResolvedValue(true);
  mockGetUserByInviteToken.mockReset();
  mockGetUserByInviteToken.mockResolvedValue({ ...TEST_USER });
  mockUpdateUser.mockReset();
  mockUpdateUser.mockResolvedValue({ ...TEST_USER, password: 'hashed:new' });
  mockClearUserInviteToken.mockClear();
  mockInvalidatePending.mockClear();
  mockGetBowlerByEmailSystemAdmin.mockClear();
  mockGetBowlerByEmailSystemAdmin.mockResolvedValue(undefined);
  mockHashPassword.mockClear();
  mockSafeTokenCompare.mockClear();
});

afterEach(() => vi.clearAllMocks());

async function flushFireAndForget() {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setImmediate(r));
  }
}

async function postSetPassword(body: unknown) {
  return fetch(`${baseUrl}/api/auth/set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/set-password — password-changed email dispatch (task #409)', () => {
  it('invokes sendPasswordChangedNotification with the user email/name and request context after a successful reset', async () => {
    const res = await postSetPassword({
      token: 'valid-token-1234',
      password: 'BrandNewPw!2026XX',
    });
    expect(res.status).toBe(200);

    await flushFireAndForget();

    expect(mockSendPasswordChangedNotification).toHaveBeenCalledTimes(1);
    const call = mockSendPasswordChangedNotification.mock.calls[0] as unknown as [
      string,
      string,
      { changedAt: Date; ipAddress: string | null; userAgent: string | null },
    ];
    const [toEmail, name, ctx] = call;
    expect(toEmail).toBe(TEST_USER.email);
    expect(name).toBe(TEST_USER.name);
    expect(ctx.changedAt).toBeInstanceOf(Date);
    expect(ctx.ipAddress).toBe('198.51.100.7');
    expect(typeof ctx.userAgent === 'string' || ctx.userAgent === null).toBe(true);

    // Strict ordering: the password row must be persisted BEFORE we
    // dispatch the notice. Otherwise a crash between the two could
    // send a misleading "your password was just changed" email.
    const updateOrder = mockUpdateUser.mock.invocationCallOrder[0];
    const notifyOrder =
      mockSendPasswordChangedNotification.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(notifyOrder);
  });

  it('does NOT invoke the helper when the token is missing', async () => {
    const res = await postSetPassword({ password: 'BrandNewPw!2026XX' });
    expect(res.status).toBe(400);
    await flushFireAndForget();
    expect(mockSendPasswordChangedNotification).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('does NOT invoke the helper when the new password fails the strength check', async () => {
    const res = await postSetPassword({
      token: 'valid-token-1234',
      password: 'short',
    });
    expect(res.status).toBe(400);
    await flushFireAndForget();
    expect(mockSendPasswordChangedNotification).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('does NOT invoke the helper when the token is unknown', async () => {
    mockGetUserByInviteToken.mockResolvedValueOnce(undefined);
    const res = await postSetPassword({
      token: 'wrong-token',
      password: 'BrandNewPw!2026XX',
    });
    expect(res.status).toBe(400);
    await flushFireAndForget();
    expect(mockSendPasswordChangedNotification).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('does NOT invoke the helper when the token is expired', async () => {
    mockGetUserByInviteToken.mockResolvedValueOnce({
      ...TEST_USER,
      inviteTokenExpiry: PAST_EXPIRY,
    });
    const res = await postSetPassword({
      token: 'valid-token-1234',
      password: 'BrandNewPw!2026XX',
    });
    expect(res.status).toBe(400);
    await flushFireAndForget();
    expect(mockSendPasswordChangedNotification).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('still returns 200 when the email helper rejects (best-effort contract)', async () => {
    mockSendPasswordChangedNotification.mockRejectedValueOnce(
      new Error('SendGrid 503'),
    );
    const res = await postSetPassword({
      token: 'valid-token-1234',
      password: 'BrandNewPw!2026XX',
    });
    expect(res.status).toBe(200);
    await flushFireAndForget();
    expect(mockSendPasswordChangedNotification).toHaveBeenCalledTimes(1);
    expect(mockUpdateUser).toHaveBeenCalledTimes(1);
  });
});
