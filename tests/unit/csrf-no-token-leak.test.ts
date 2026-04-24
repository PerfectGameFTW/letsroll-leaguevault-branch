/**
 * Regression test for task #307.
 *
 * The CSRF middleware in `server/middleware/csrf.ts` logs warnings on
 * rejection that include the request method and path. None of those log
 * lines may ever interpolate the actual session-bound CSRF token (or
 * the header token, or the session ID) — even at debug level — because
 * an operator who turns on `LOG_LEVEL=debug` for an incident must not
 * end up shipping the live CSRF tokens to the production log sink,
 * where they'd be replayable until session expiry.
 *
 * This test mocks the logger so we can capture every line emitted,
 * exercises every reject branch with known token bytes, and asserts
 * that none of those captured strings contains any of the token
 * material or the session ID.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  assertNoTokenLeak as sharedAssertNoTokenLeak,
  type CapturedLogLine,
} from '../helpers/no-token-leak';

const captured: CapturedLogLine[] = [];

function record(level: string) {
  return (message: string, ...args: unknown[]) => {
    const tail = args.length > 0 ? ' ' + JSON.stringify(args) : '';
    captured.push({ level, line: `${message}${tail}` });
  };
}

vi.mock('../../server/logger', () => ({
  createLogger: () => ({
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
  }),
}));

import { csrfProtection } from '../../server/middleware/csrf';

const SESSION_TOKEN = 'a'.repeat(64);
const HEADER_TOKEN_WRONG = 'b'.repeat(64);
const SESSION_ID = 'sid-deadbeefcafebabe-1234567890';

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(opts: {
  session?: { csrfToken?: string; id?: string } | null;
  headers?: Record<string, string>;
  method?: string;
  path?: string;
}): Request {
  return {
    method: opts.method ?? 'POST',
    path: opts.path ?? '/api/teams',
    session: opts.session === null ? undefined : (opts.session ?? {}),
    headers: opts.headers ?? {},
  } as unknown as Request;
}

function assertNoTokenLeak() {
  // Delegates to the shared helper (`tests/helpers/no-token-leak.ts`)
  // so every sibling no-leak test (task #396) uses the same regex /
  // 8-byte-prefix check. SESSION_ID has no useful prefix to enforce
  // (it's not a token), so it goes in `partials` to keep the prefix
  // assertion meaningful for the actual tokens.
  sharedAssertNoTokenLeak(captured, {
    full: [SESSION_TOKEN, HEADER_TOKEN_WRONG],
    partials: [SESSION_ID],
  });
}

beforeEach(() => {
  captured.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CSRF middleware does not leak token material to logs', () => {
  it('rejects when no session is available without leaking anything', () => {
    const req = makeReq({ session: null, path: '/api/teams' });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    csrfProtection(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(captured.length).toBeGreaterThan(0);
    assertNoTokenLeak();
  });

  it('rejects when the session has no CSRF token without leaking anything', () => {
    const req = makeReq({ session: { id: SESSION_ID }, path: '/api/teams' });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    csrfProtection(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(captured.length).toBeGreaterThan(0);
    assertNoTokenLeak();
  });

  it('rejects on token mismatch without leaking the session or header token', () => {
    const req = makeReq({
      session: { csrfToken: SESSION_TOKEN, id: SESSION_ID },
      headers: { 'x-csrf-token': HEADER_TOKEN_WRONG },
      path: '/api/teams',
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    csrfProtection(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(captured.length).toBeGreaterThan(0);
    assertNoTokenLeak();
  });

  it('rejects when the header token is missing without leaking the session token', () => {
    const req = makeReq({
      session: { csrfToken: SESSION_TOKEN, id: SESSION_ID },
      headers: {},
      path: '/api/teams',
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    csrfProtection(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(captured.length).toBeGreaterThan(0);
    assertNoTokenLeak();
  });

  it('passes through on a valid token and emits no log line at all', () => {
    const req = makeReq({
      session: { csrfToken: SESSION_TOKEN, id: SESSION_ID },
      headers: { 'x-csrf-token': SESSION_TOKEN },
      path: '/api/teams',
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(captured).toEqual([]);
  });

  it('pins the exact warn-line shape on token mismatch', () => {
    // Pinning the warn-line shape means a future edit that appends
    // the session/header token (or any other field) to this log line
    // will fail this assertion immediately.
    const req = makeReq({
      session: { csrfToken: SESSION_TOKEN, id: SESSION_ID },
      headers: { 'x-csrf-token': HEADER_TOKEN_WRONG },
      path: '/api/teams',
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    csrfProtection(req, res, next);
    const warnLines = captured.filter((c) => c.level === 'warn');
    expect(warnLines.length).toBe(1);
    expect(warnLines[0].line).toBe('CSRF token mismatch for POST /api/teams');
  });

  it('does not leak the token even when the request path itself contains token-shaped material', () => {
    // Defensive: a misbehaving caller might put a token-shaped value
    // (or even the literal session token) in the URL path. The
    // middleware logs `req.path`, so the path appears verbatim — but
    // the assertion below is that the middleware does not ADDITIONALLY
    // interpolate the actual session/header token. The path-derived
    // bytes are the caller's choice, not a middleware leak.
    const tokenShapedPath = `/api/teams/${'c'.repeat(64)}`;
    const req = makeReq({
      session: { csrfToken: SESSION_TOKEN, id: SESSION_ID },
      headers: { 'x-csrf-token': HEADER_TOKEN_WRONG },
      path: tokenShapedPath,
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    csrfProtection(req, res, next);
    const warnLines = captured.filter((c) => c.level === 'warn');
    expect(warnLines.length).toBe(1);
    expect(warnLines[0].line).toBe(`CSRF token mismatch for POST ${tokenShapedPath}`);
    // Path bytes are reflected (caller's choice), but the actual
    // session/header tokens are NOT.
    assertNoTokenLeak();
  });
});
