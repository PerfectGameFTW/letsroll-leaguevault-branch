/**
 * Unit test for the server-side forced-rotation gate (task #455).
 *
 * The client-side ProtectedRoute and RootRedirectHandler guards
 * (client/src/components/protected-route.tsx, client/src/App.tsx)
 * are UX only — without `requirePasswordRotated` on the server, an
 * authenticated user whose `mustChangePassword` row is true could
 * still drive every protected endpoint via curl, fetch, or Postman
 * with their session cookie. This test pins the contract that
 * matters for security:
 *
 *   1. A flagged user gets 403 PASSWORD_CHANGE_REQUIRED on a
 *      protected /api route, NOT a 200 with the response body.
 *   2. The same flagged user can still hit the small allowlist
 *      (auth routes, /api/user, /api/logout, /api/csrf-token, and
 *      /api/account/change-password) — otherwise they would be
 *      stranded with no way to actually rotate.
 *   3. Anonymous traffic flows through untouched (the gate is a
 *      property of an authenticated session, and downstream
 *      requireAuth handles unauthenticated requests).
 *   4. A non-flagged user (mustChangePassword=false or undefined)
 *      flows through untouched — happy path.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { requirePasswordRotated } from '../../server/middleware/auth';

type ActingUser = { id: number; mustChangePassword?: boolean } | null;
let actingUser: ActingUser = null;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Stub the passport surface the middleware reads. Each test
  // mutates `actingUser` to control what the gate observes.
  app.use((req, _res, next) => {
    (req as unknown as { user: ActingUser }).user = actingUser;
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () =>
      actingUser !== null;
    next();
  });

  // Mount the gate exactly the way server/routes/index.ts does:
  // app.use('/api', requirePasswordRotated). Then register a few
  // representative route handlers BOTH inside the allowlist and
  // outside it so we can exercise both branches.
  app.use('/api', requirePasswordRotated);

  // Outside the allowlist — should be blocked when flagged.
  const ok = (_req: Request, res: Response) => res.json({ ok: true });
  app.get('/api/leagues', ok);
  app.get('/api/bowlers', ok);
  app.post('/api/payments/foo', ok);

  // Inside the allowlist — should always pass through.
  app.get('/api/auth/user', ok);
  app.post('/api/auth/logout', ok);
  app.post('/api/auth/forgot-password', ok);
  app.post('/api/auth/set-password', ok);
  app.get('/api/user', ok);
  app.post('/api/logout', ok);
  app.get('/api/csrf-token', ok);
  app.post('/api/account/change-password', ok);

  // A sibling /api/account route that is NOT change-password — used
  // to prove the allowlist matches by path, not by router prefix.
  app.patch('/api/account/profile/1', ok);

  // Catch-all errors so the test surfaces meaningful failures.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: { message: (err as Error).message } });
  });

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
  actingUser = null;
});

describe('requirePasswordRotated — server-side forced-rotation gate (task #455)', () => {
  it('returns 403 PASSWORD_CHANGE_REQUIRED on a protected endpoint when the user is flagged', async () => {
    actingUser = { id: 1, mustChangePassword: true };
    const res = await fetch(`${baseUrl}/api/leagues`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('blocks every non-allowlisted protected endpoint, not just one', async () => {
    actingUser = { id: 1, mustChangePassword: true };
    // Three different routers — leagues, bowlers, payments — to
    // prove the gate is mounted broadly and isn't router-specific.
    for (const url of ['/api/leagues', '/api/bowlers']) {
      const res = await fetch(`${baseUrl}${url}`);
      expect(res.status, `${url} should be blocked`).toBe(403);
      const body = await res.json();
      expect(body.error?.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
    const post = await fetch(`${baseUrl}/api/payments/foo`, { method: 'POST' });
    expect(post.status).toBe(403);
  });

  it('blocks /api/account routes other than /api/account/change-password (allowlist is path-exact, not prefix)', async () => {
    actingUser = { id: 1, mustChangePassword: true };
    const res = await fetch(`${baseUrl}/api/account/profile/1`, { method: 'PATCH' });
    // Critical regression guard: a prefix-style allowlist on
    // /api/account/ would let the user mutate their own profile
    // before rotating, which is not the intent. Only the exact
    // change-password path is exempt.
    expect(res.status).toBe(403);
  });

  it('lets the flagged user hit /api/account/change-password (the rotation endpoint itself)', async () => {
    actingUser = { id: 1, mustChangePassword: true };
    const res = await fetch(`${baseUrl}/api/account/change-password`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('lets the flagged user hit every /api/auth/* route (login, logout, user, set-password, forgot-password)', async () => {
    actingUser = { id: 1, mustChangePassword: true };
    for (const [method, url] of [
      ['GET', '/api/auth/user'],
      ['POST', '/api/auth/logout'],
      ['POST', '/api/auth/forgot-password'],
      ['POST', '/api/auth/set-password'],
    ] as const) {
      const res = await fetch(`${baseUrl}${url}`, { method });
      expect(res.status, `${method} ${url}`).toBe(200);
    }
  });

  it('lets the flagged user hit /api/user and /api/logout (the SPA-side aliases)', async () => {
    actingUser = { id: 1, mustChangePassword: true };
    const userRes = await fetch(`${baseUrl}/api/user`);
    expect(userRes.status).toBe(200);
    const logoutRes = await fetch(`${baseUrl}/api/logout`, { method: 'POST' });
    expect(logoutRes.status).toBe(200);
  });

  it('lets the flagged user hit /api/csrf-token (so the change-password POST can include a CSRF header)', async () => {
    actingUser = { id: 1, mustChangePassword: true };
    const res = await fetch(`${baseUrl}/api/csrf-token`);
    expect(res.status).toBe(200);
  });

  it('lets a non-flagged user (mustChangePassword=false) hit any protected endpoint — happy path', async () => {
    actingUser = { id: 1, mustChangePassword: false };
    const res = await fetch(`${baseUrl}/api/leagues`);
    expect(res.status).toBe(200);
  });

  it('lets a non-flagged user (mustChangePassword=undefined for legacy rows) hit any protected endpoint', async () => {
    // Defense-in-depth: the schema defaults mustChangePassword to
    // false on every row, but an undefined / missing field on the
    // user object (e.g. a future migration that goes wrong, or a
    // serialization that drops the column) must NOT be treated as
    // "true" — that would lock every user out of the app.
    actingUser = { id: 1 };
    const res = await fetch(`${baseUrl}/api/leagues`);
    expect(res.status).toBe(200);
  });

  it('passes anonymous traffic through untouched (downstream auth handles 401)', async () => {
    actingUser = null;
    // The catch-handler in the test app responds 200 — meaning the
    // gate called next() and let the handler run. Real production
    // routes are wrapped in requireAuth, which would 401 these, but
    // the gate itself must not 403 anonymous requests (the flag is
    // a property of an authenticated session).
    const res = await fetch(`${baseUrl}/api/leagues`);
    expect(res.status).toBe(200);
  });
});
