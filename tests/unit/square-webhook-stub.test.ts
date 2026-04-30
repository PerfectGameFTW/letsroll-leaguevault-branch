/**
 * Task #612 — Square webhook tripwire stub coverage.
 *
 * We do not subscribe to any Square webhook events today, but the
 * CSRF exemption at `server/middleware/csrf.ts` is a generic prefix
 * match for `/payments-provider/webhooks`, so a Square subscription
 * configured out-of-band would deliver events to
 * `POST /api/payments-provider/webhooks/square`. Without a stub the
 * request would 404 silently and we'd lose money-relevant events
 * with no alarms.
 *
 * The stub MUST:
 *   1. Answer with HTTP 501 and the structured error code
 *      `SQUARE_WEBHOOK_NOT_IMPLEMENTED`.
 *   2. Emit a single `log.error` line — not `warn` — with method,
 *      path, all request headers, and the raw body. `log.error` is
 *      the visibility-floor in production; `warn` would be too
 *      easy to miss when on-call is paging.
 *   3. Touch no storage method (there's no payment row to update;
 *      this is a tripwire, not a handler).
 *   4. Run with no signature requirement — there is no Square
 *      webhook secret to verify against today, and the whole point
 *      is to fire on any unexpected delivery.
 *
 * The companion integration test
 * `tests/api/clover-webhook-routing.test.ts` already pins that the
 * `/payments-provider/webhooks` prefix is reachable without session
 * auth; the Square stub inherits that property.
 */
import {
  afterAll, beforeAll, beforeEach,
  describe, expect, it, vi,
} from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const mockStorage = {
  getPaymentByCloverChargeId: vi.fn(),
  refundPayment: vi.fn(),
  openDispute: vi.fn(),
  updatePayment: vi.fn(),
};
vi.mock('../../server/storage', () => ({ storage: mockStorage }));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../server/logger', () => ({ logger: fakeLogger, createLogger: () => fakeLogger }));

const webhooksRouter = (await import('../../server/routes/payments-provider/webhooks')).default;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  // Mirror the production wiring: capture rawBody on the global JSON
  // parser so the stub can log the exact bytes that came in (which
  // is what a future signature-verifying handler will need anyway).
  app.use(express.json({
    verify: (req: express.Request, _res, buf) => {
      req.rawBody = buf;
    },
  }));
  // Also accept raw bytes for non-JSON content types so the tripwire
  // exercises the rawBody path even when a misconfigured subscription
  // sends, say, `application/x-www-form-urlencoded`.
  app.use(express.raw({
    type: () => true,
    verify: (req: express.Request, _res, buf) => {
      if (!req.rawBody) req.rawBody = buf;
    },
  }));
  app.use('/api/payments-provider/webhooks', webhooksRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  for (const fn of Object.values(mockStorage)) (fn as ReturnType<typeof vi.fn>).mockReset();
  fakeLogger.info.mockReset();
  fakeLogger.warn.mockReset();
  fakeLogger.error.mockReset();
  fakeLogger.debug.mockReset();
});

async function postSquare(
  body: string,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/api/payments-provider/webhooks/square`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

describe('POST /api/payments-provider/webhooks/square — tripwire stub (task #612)', () => {
  it('responds 501 with SQUARE_WEBHOOK_NOT_IMPLEMENTED and a non-empty message', async () => {
    const res = await postSquare(JSON.stringify({
      type: 'payment.updated',
      event_id: 'evt_sq_1',
      data: { type: 'payment', id: 'sq_pay_1' },
    }));

    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: { code: 'SQUARE_WEBHOOK_NOT_IMPLEMENTED' },
    });
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it('emits exactly one log.error (NOT warn / info) with method, path, headers, and rawBody', async () => {
    const eventBody = JSON.stringify({
      type: 'refund.updated',
      event_id: 'evt_sq_2',
      data: { type: 'refund', id: 'sq_rfnd_2' },
    });
    await postSquare(eventBody, {
      'x-square-signature': 'sig_for_diagnostic_capture',
      'square-environment': 'Production',
      'square-retry-number': '3',
    });

    // The "loud, not silent" requirement is the whole point of the
    // task. If a future refactor downgrades this to warn or info,
    // operators on a default-warn or default-info log floor would
    // miss it — exactly the regression the task was filed to prevent.
    expect(fakeLogger.error).toHaveBeenCalledTimes(1);
    expect(fakeLogger.warn).not.toHaveBeenCalled();
    expect(fakeLogger.info).not.toHaveBeenCalled();

    const [message, context] = fakeLogger.error.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(message).toMatch(/Square webhook/i);
    expect(context).toMatchObject({
      method: 'POST',
      path: '/api/payments-provider/webhooks/square',
      rawBody: eventBody,
    });
    const headers = context.headers as Record<string, string>;
    expect(headers['x-square-signature']).toBe('sig_for_diagnostic_capture');
    expect(headers['square-environment']).toBe('Production');
    expect(headers['square-retry-number']).toBe('3');
  });

  it('does not touch storage — there is no payment row to update', async () => {
    await postSquare(JSON.stringify({
      type: 'dispute.created',
      data: { type: 'dispute', id: 'sq_disp_1', object: { dispute: { id: 'sq_disp_1' } } },
    }));

    expect(mockStorage.getPaymentByCloverChargeId).not.toHaveBeenCalled();
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
    expect(mockStorage.openDispute).not.toHaveBeenCalled();
    expect(mockStorage.updatePayment).not.toHaveBeenCalled();
  });

  it('still 501s and still logs even when the body is empty', async () => {
    const res = await fetch(`${baseUrl}/api/payments-provider/webhooks/square`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(501);
    expect(fakeLogger.error).toHaveBeenCalledTimes(1);
  });

  it('does not require any HMAC signature header — fires on every delivery', async () => {
    // No `x-square-signature`, no `x-clover-signature`, no anything.
    // The whole point of the tripwire is to surface ANY unexpected
    // delivery. If a future refactor ever adds signature
    // verification here without also wiring up a Square webhook
    // secret, the path goes back to silently 401-ing or 503-ing
    // and on-call stops getting the alarm.
    const res = await postSquare(JSON.stringify({ type: 'whatever' }));

    expect(res.status).toBe(501);
    expect(fakeLogger.error).toHaveBeenCalledTimes(1);
  });
});
