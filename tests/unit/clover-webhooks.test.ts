/**
 * Task #577 — Clover webhook receiver coverage.
 *
 * Asserts that incoming Clover webhook events update the matching
 * payment row's status / timestamps and that unknown / out-of-order /
 * unsigned events are safely ignored or rejected. Mounts the real
 * webhook router at the same sub-path the app uses
 * (`/api/payments-provider/webhooks`).
 *
 * Signature: this file relies on the test-only escape hatch in
 * `verifyCloverSignature` (no `CLOVER_WEBHOOK_SIGNING_SECRET` + `NODE_ENV='test'`
 * → skip verification). The "with-secret" cases below set the env var
 * before booting the request and assert that good / bad signatures
 * are accepted / rejected.
 *
 * The companion integration test
 * `tests/api/clover-webhook-routing.test.ts` boots the real app stack
 * and asserts that the route is reachable WITHOUT session auth (the
 * regression that motivated this file).
 */
import {
  afterAll, afterEach, beforeAll, beforeEach,
  describe, expect, it, vi,
} from 'vitest';
import express from 'express';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const mockStorage = {
  getPaymentByCloverChargeId: vi.fn(),
  refundPayment: vi.fn(),
  openDispute: vi.fn(),
  updatePayment: vi.fn(),
};
vi.mock('../../server/storage', () => ({ storage: mockStorage }));

// eslint-disable-next-line local/factory-must-use-schema -- mocked logger, not a schema row
const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../server/logger', () => ({ logger: fakeLogger, createLogger: () => fakeLogger }));

const webhooksRouter = (await import('../../server/routes/payments-provider/webhooks')).default;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  // Mirror the production wiring: capture rawBody on the global JSON
  // parser so the webhook's HMAC verifier can hash the exact bytes.
  app.use(express.json({
    verify: (req: express.Request, _res, buf) => {
      req.rawBody = buf;
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

// The webhook route's signature-verifier escape hatch fires only when
// `NODE_ENV === 'test'`. Vitest sets that by default, but only if the
// var isn't already set — a wrapper script that exports
// `NODE_ENV=development` ahead of `npm test` silently disables the
// escape hatch and the route returns 503 WEBHOOK_NOT_CONFIGURED for
// every request, surfacing as `expected 503 to be 200` on every case
// in this file. Force it explicitly so the suite is robust regardless
// of how the runner is invoked.
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
beforeAll(() => {
  process.env.NODE_ENV = 'test';
});
afterAll(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

beforeEach(() => {
  for (const fn of Object.values(mockStorage)) (fn as ReturnType<typeof vi.fn>).mockReset();
  process.env.NODE_ENV = 'test';
  delete process.env.CLOVER_WEBHOOK_SIGNING_SECRET;
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.CLOVER_WEBHOOK_SIGNING_SECRET;
});

async function postEvent(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/api/payments-provider/webhooks/clover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function sign(secret: string, body: Record<string, unknown>): string {
  return createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}

describe('POST /api/payments-provider/webhooks/clover — refund / dispute coverage', () => {
  it('refund.created marks the payment refunded, stamps refundedAt, and persists the refund id', async () => {
    mockStorage.getPaymentByCloverChargeId.mockResolvedValue({
      id: 4242, status: 'paid', type: 'clover', cloverChargeId: 'cv_pay_42',
    });
    mockStorage.refundPayment.mockResolvedValue({
      id: 4242, status: 'refunded', squareRefundId: 'cv_rfnd_42',
      refundedAt: '2026-04-28T12:00:00.000Z',
    });

    const res = await postEvent({
      id: 'evt_1', type: 'refund.created',
      data: { object: { id: 'cv_rfnd_42', charge: 'cv_pay_42', reason: 'Customer request' } },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      data: {
        received: true, action: 'refund_settled', paymentId: 4242,
        status: 'refunded', refundedAt: '2026-04-28T12:00:00.000Z',
      },
    });
    expect(mockStorage.refundPayment).toHaveBeenCalledWith(4242, 'cv_rfnd_42', 'Customer request');
  });

  it('accepts the `charge.refunded` alias and applies the same row update', async () => {
    mockStorage.getPaymentByCloverChargeId.mockResolvedValue({
      id: 4243, status: 'paid', type: 'clover', cloverChargeId: 'cv_pay_43',
    });
    mockStorage.refundPayment.mockResolvedValue({
      id: 4243, status: 'refunded', squareRefundId: 'cv_rfnd_43',
      refundedAt: '2026-04-28T12:01:00.000Z',
    });

    const res = await postEvent({
      id: 'evt_2', type: 'charge.refunded',
      data: { object: { id: 'cv_rfnd_43', charge: 'cv_pay_43' } },
    });

    expect(res.status).toBe(200);
    expect(mockStorage.refundPayment).toHaveBeenCalledWith(
      4243, 'cv_rfnd_43', 'Refund settled via Clover webhook',
    );
  });

  it('treats a duplicate refund event for an already-refunded row as a no-op (does not re-stamp refundedAt)', async () => {
    mockStorage.getPaymentByCloverChargeId.mockResolvedValue({
      id: 4244, status: 'refunded', type: 'clover', cloverChargeId: 'cv_pay_44',
      squareRefundId: 'cv_rfnd_44', refundedAt: '2026-04-27T12:00:00.000Z',
    });

    const res = await postEvent({
      id: 'evt_3', type: 'refund.created',
      data: { object: { id: 'cv_rfnd_44', charge: 'cv_pay_44' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { received: true, ignored: 'already_refunded', paymentId: 4244 },
    });
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
    expect(mockStorage.updatePayment).not.toHaveBeenCalled();
  });

  it('refund.failed acks 200 without touching the payment row', async () => {
    const res = await postEvent({
      id: 'evt_4', type: 'refund.failed',
      data: { object: { id: 'cv_rfnd_fail', charge: 'cv_pay_45', reason: 'insufficient_funds' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true, data: { received: true, ignored: 'refund_failed_logged' },
    });
    expect(mockStorage.getPaymentByCloverChargeId).not.toHaveBeenCalled();
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
  });

  it('dispute.created marks the payment disputed, stamps disputedAt, and persists the dispute id', async () => {
    mockStorage.getPaymentByCloverChargeId.mockResolvedValue({
      id: 4246, status: 'paid', type: 'clover', cloverChargeId: 'cv_pay_46',
    });
    mockStorage.openDispute.mockResolvedValue({
      id: 4246, status: 'disputed', disputeId: 'cv_disp_1',
      disputedAt: '2026-04-28T12:30:00.000Z',
    });

    const res = await postEvent({
      id: 'evt_5', type: 'dispute.created',
      data: { object: { id: 'cv_disp_1', charge: 'cv_pay_46' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: {
        received: true, action: 'dispute_opened', paymentId: 4246,
        status: 'disputed', disputedAt: '2026-04-28T12:30:00.000Z',
      },
    });
    expect(mockStorage.openDispute).toHaveBeenCalledWith(4246, 'cv_disp_1');
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
  });

  it('chargeback.created applies the same dispute update via the alias', async () => {
    mockStorage.getPaymentByCloverChargeId.mockResolvedValue({
      id: 4247, status: 'paid', type: 'clover', cloverChargeId: 'cv_pay_47',
    });
    mockStorage.openDispute.mockResolvedValue({
      id: 4247, status: 'disputed', disputeId: 'cv_cb_1',
      disputedAt: '2026-04-28T12:31:00.000Z',
    });

    const res = await postEvent({
      id: 'evt_6', type: 'chargeback.created',
      data: { object: { id: 'cv_cb_1', charge: 'cv_pay_47' } },
    });

    expect(res.status).toBe(200);
    expect(mockStorage.openDispute).toHaveBeenCalledWith(4247, 'cv_cb_1');
  });

  it('treats a duplicate dispute event for an already-disputed row as a no-op', async () => {
    mockStorage.getPaymentByCloverChargeId.mockResolvedValue({
      id: 4248, status: 'disputed', type: 'clover', cloverChargeId: 'cv_pay_48',
      disputeId: 'cv_disp_existing', disputedAt: '2026-04-27T11:00:00.000Z',
    });

    const res = await postEvent({
      id: 'evt_6b', type: 'charge.dispute.created',
      data: { object: { id: 'cv_disp_existing', charge: 'cv_pay_48' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { received: true, ignored: 'already_disputed', paymentId: 4248 },
    });
    expect(mockStorage.openDispute).not.toHaveBeenCalled();
  });

  it('dispute event arriving on a refunded row does not overwrite refunded status', async () => {
    mockStorage.getPaymentByCloverChargeId.mockResolvedValue({
      id: 4249, status: 'refunded', type: 'clover', cloverChargeId: 'cv_pay_49',
      squareRefundId: 'cv_rfnd_49', refundedAt: '2026-04-27T12:00:00.000Z',
      disputeId: null, disputedAt: null,
    });

    const res = await postEvent({
      id: 'evt_6b2', type: 'dispute.created',
      data: { object: { id: 'cv_disp_after_refund', charge: 'cv_pay_49' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { received: true, ignored: 'already_refunded', paymentId: 4249 },
    });
    expect(mockStorage.openDispute).not.toHaveBeenCalled();
  });

  it('dispute event whose charge id we do not know about acks 200 without mutation', async () => {
    mockStorage.getPaymentByCloverChargeId.mockResolvedValue(undefined);

    const res = await postEvent({
      id: 'evt_6c', type: 'dispute.created',
      data: { object: { id: 'cv_disp_unknown', charge: 'cv_pay_unknown' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true, data: { received: true, ignored: 'unknown_charge' },
    });
    expect(mockStorage.openDispute).not.toHaveBeenCalled();
  });

  it('dispute event with no charge id acks 200 without lookup', async () => {
    const res = await postEvent({
      id: 'evt_6d', type: 'dispute.created',
      data: { object: { id: 'cv_disp_no_charge' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true, data: { received: true, ignored: 'missing_charge' },
    });
    expect(mockStorage.getPaymentByCloverChargeId).not.toHaveBeenCalled();
    expect(mockStorage.openDispute).not.toHaveBeenCalled();
  });

  it('unknown event type acks 200 (so Clover stops retrying)', async () => {
    const res = await postEvent({
      id: 'evt_7', type: 'customer.subscription.unicorn',
      data: { object: { id: 'whatever' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true, data: { received: true, ignored: 'unknown_event_type' },
    });
    expect(mockStorage.getPaymentByCloverChargeId).not.toHaveBeenCalled();
  });

  it('missing event type acks 200', async () => {
    const res = await postEvent({ id: 'evt_8', data: { object: { id: 'oops' } } });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true, data: { received: true, ignored: 'missing_type' },
    });
  });

  it('refund event whose charge id we do not know about acks 200', async () => {
    mockStorage.getPaymentByCloverChargeId.mockResolvedValue(undefined);

    const res = await postEvent({
      id: 'evt_9', type: 'refund.created',
      data: { object: { id: 'cv_rfnd_unknown', charge: 'cv_pay_unknown' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true, data: { received: true, ignored: 'unknown_charge' },
    });
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
  });

  it('refund event with no charge id acks 200', async () => {
    const res = await postEvent({
      id: 'evt_10', type: 'refund.created',
      data: { object: { id: 'cv_rfnd_no_charge' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true, data: { received: true, ignored: 'missing_charge' },
    });
    expect(mockStorage.getPaymentByCloverChargeId).not.toHaveBeenCalled();
  });
});

describe('POST /api/payments-provider/webhooks/clover — HMAC signature gate', () => {
  it('rejects a request with no signature header when the secret is configured', async () => {
    process.env.CLOVER_WEBHOOK_SIGNING_SECRET = 'whsec_test_a';

    const res = await postEvent({ id: 'evt_sig_1', type: 'refund.created' });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: { code: 'WEBHOOK_SIGNATURE_MISSING' },
    });
    expect(mockStorage.getPaymentByCloverChargeId).not.toHaveBeenCalled();
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
  });

  it('rejects a request whose signature does not match the body', async () => {
    process.env.CLOVER_WEBHOOK_SIGNING_SECRET = 'whsec_test_b';

    const res = await postEvent(
      { id: 'evt_sig_2', type: 'refund.created' },
      { 'x-clover-signature': 'deadbeef' },
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: { code: 'WEBHOOK_SIGNATURE_INVALID' },
    });
    expect(mockStorage.refundPayment).not.toHaveBeenCalled();
  });

  it('accepts a request whose signature matches and processes the event', async () => {
    const secret = 'whsec_test_c';
    process.env.CLOVER_WEBHOOK_SIGNING_SECRET = secret;
    mockStorage.getPaymentByCloverChargeId.mockResolvedValue({
      id: 4250, status: 'paid', type: 'clover', cloverChargeId: 'cv_pay_50',
    });
    mockStorage.refundPayment.mockResolvedValue({
      id: 4250, status: 'refunded', refundedAt: '2026-04-28T13:00:00.000Z',
    });

    const body = {
      id: 'evt_sig_3', type: 'refund.created',
      data: { object: { id: 'cv_rfnd_50', charge: 'cv_pay_50' } },
    };
    const res = await postEvent(body, { 'x-clover-signature': sign(secret, body) });

    expect(res.status).toBe(200);
    expect(mockStorage.refundPayment).toHaveBeenCalledWith(
      4250, 'cv_rfnd_50', 'Refund settled via Clover webhook',
    );
  });
});
