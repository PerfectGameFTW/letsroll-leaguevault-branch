/**
 * Task #577 — DB-backed integration test for the Clover webhook
 * receiver.
 *
 * Why this exists alongside `tests/unit/clover-webhooks.test.ts`:
 * the unit suite mocks `storage` and asserts the receiver calls the
 * expected method, but doesn't prove the underlying row in Postgres
 * actually changed. The reviewer (#577 round 3) flagged that as
 * insufficient — a missed `await`, a wrong column write, or a
 * Drizzle filter regression would all pass the mocked tests while
 * silently leaving the production payments row in `paid` after a
 * dispute or refund.
 *
 * This file:
 *   1. Boots the real webhook router in-process against the real
 *      `storage` / Postgres connection (no mocks, no spies).
 *   2. Seeds a real bowler + payment row under the existing vitest
 *      org A baseline league.
 *   3. POSTs HMAC-signed events at the in-process server.
 *   4. Reads the row back via `storage.getPaymentById` and asserts
 *      `status` / `refundedAt` / `disputedAt` / `disputeId` /
 *      `squareRefundId` actually changed in the database.
 *
 * Branches covered end-to-end:
 *   - refund.created → row goes paid → refunded, refundedAt + refund
 *     id persisted.
 *   - dispute.created → row goes paid → disputed, disputeId +
 *     disputedAt persisted.
 *   - duplicate refund → second event is a no-op (refundedAt unchanged).
 *   - duplicate dispute → second event is a no-op (disputedAt unchanged).
 *   - unknown charge id → no row is mutated.
 *   - unknown / missing event type → no row is mutated.
 *
 * The test exercises the HMAC signature gate by setting
 * `CLOVER_WEBHOOK_SIGNING_SECRET` on the test process and signing
 * each request body. The verifier is module-level state in the
 * router, so the secret only affects the in-process app — it is not
 * a shared resource with the dev server or other test files.
 */
import {
  afterAll, beforeAll, describe, expect, it,
} from 'vitest';
import express from 'express';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { db } from '../../server/db';
import { storage } from '../../server/storage';
import { organizations, leagues } from '@shared/schema';
import webhooksRouter from '../../server/routes/payments-provider/webhooks';

const TEST_SECRET = 'whsec_clover_webhook_db_integration_test';

let server: Server;
let baseUrl: string;
let bowlerId: number;
let leagueId: number;
let organizationId: number;

function uniqueChargeId(tag: string): string {
  return `cv_pay_${tag}_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function uniqueDisputeId(tag: string): string {
  return `cv_disp_${tag}_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function sign(body: Record<string, unknown>): string {
  return createHmac('sha256', TEST_SECRET).update(JSON.stringify(body)).digest('hex');
}

async function postSigned(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/payments-provider/webhooks/clover`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-clover-signature': sign(body),
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.CLOVER_WEBHOOK_SIGNING_SECRET = TEST_SECRET;

  // Reuse the seeded baseline org + league instead of inserting our
  // own. Keeps the row count stable across runs and avoids racing the
  // serial-fk-bypass project's ACCESS EXCLUSIVE locks on `leagues`.
  const slug = process.env.TEST_ORG_A_SLUG || 'vitest-org-a';
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug));
  if (!org) throw new Error(`Test org "${slug}" not seeded — run global setup first`);
  organizationId = org.id;

  const [league] = await db
    .select({ id: leagues.id })
    .from(leagues)
    .where(eq(leagues.organizationId, organizationId))
    .limit(1);
  if (!league) throw new Error(`No baseline league for org "${slug}" — run global setup first`);
  leagueId = league.id;

  const bowler = await storage.createBowler({
    name: 'Clover Webhook Integration Bowler',
    organizationId,
    active: true,
    order: 0,
  });
  bowlerId = bowler.id;

  const app = express();
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
  if (bowlerId) {
    // Cascades to payments via the FK in shared/schema/payments.ts.
    await storage.deleteBowler(bowlerId);
  }
  delete process.env.CLOVER_WEBHOOK_SIGNING_SECRET;
});

async function seedPaidPayment(chargeId: string) {
  return storage.createPayment({
    bowlerId,
    leagueId,
    amount: 2500,
    weekOf: new Date('2026-04-20T00:00:00Z').toISOString(),
    status: 'paid',
    type: 'clover',
    cloverChargeId: chargeId,
    receiptEmailMissing: true,
  });
}

describe('Clover webhook end-to-end against the real DB (task #577)', () => {
  it('refund.created persists status=refunded, refundedAt, and squareRefundId on the real row', async () => {
    const chargeId = uniqueChargeId('refund_happy');
    const payment = await seedPaidPayment(chargeId);
    const refundProviderId = uniqueDisputeId('rfnd');

    const before = Date.now();
    const res = await postSigned({
      id: 'evt_db_refund_1',
      type: 'refund.created',
      data: { object: { id: refundProviderId, charge: chargeId, reason: 'Customer asked' } },
    });
    expect(res.status).toBe(200);

    const updated = await storage.getPaymentById(payment.id);
    expect(updated).toBeDefined();
    expect(updated?.status).toBe('refunded');
    expect(updated?.squareRefundId).toBe(refundProviderId);
    expect(updated?.refundReason).toBe('Customer asked');
    const stamped = updated?.refundedAt ? new Date(updated.refundedAt).getTime() : 0;
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('dispute.created persists status=disputed, disputeId, and disputedAt on the real row', async () => {
    const chargeId = uniqueChargeId('dispute_happy');
    const payment = await seedPaidPayment(chargeId);
    const disputeProviderId = uniqueDisputeId('disp');

    const before = Date.now();
    const res = await postSigned({
      id: 'evt_db_dispute_1',
      type: 'dispute.created',
      data: { object: { id: disputeProviderId, charge: chargeId } },
    });
    expect(res.status).toBe(200);

    const updated = await storage.getPaymentById(payment.id);
    expect(updated).toBeDefined();
    expect(updated?.status).toBe('disputed');
    expect(updated?.disputeId).toBe(disputeProviderId);
    const stamped = updated?.disputedAt ? new Date(updated.disputedAt).getTime() : 0;
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
    // Dispute is a separate provider artifact from refund — refund
    // bookkeeping must remain untouched.
    expect(updated?.squareRefundId).toBeNull();
    expect(updated?.refundedAt).toBeNull();
  });

  it('chargeback.created alias also persists the dispute on the real row', async () => {
    const chargeId = uniqueChargeId('chargeback_alias');
    const payment = await seedPaidPayment(chargeId);
    const disputeProviderId = uniqueDisputeId('cb');

    const res = await postSigned({
      id: 'evt_db_dispute_alias',
      type: 'chargeback.created',
      data: { object: { id: disputeProviderId, charge: chargeId } },
    });
    expect(res.status).toBe(200);

    const updated = await storage.getPaymentById(payment.id);
    expect(updated?.status).toBe('disputed');
    expect(updated?.disputeId).toBe(disputeProviderId);
  });

  it('a duplicate / out-of-order refund event does not re-stamp refundedAt on the real row', async () => {
    const chargeId = uniqueChargeId('refund_dup');
    const payment = await seedPaidPayment(chargeId);

    // First event lands.
    const firstBody = {
      id: 'evt_db_refund_dup_1',
      type: 'refund.created',
      data: { object: { id: uniqueDisputeId('rfnd1'), charge: chargeId } },
    };
    const first = await postSigned(firstBody);
    expect(first.status).toBe(200);

    const afterFirst = await storage.getPaymentById(payment.id);
    expect(afterFirst?.status).toBe('refunded');
    const firstStamp = afterFirst?.refundedAt;
    const firstRefundId = afterFirst?.squareRefundId;
    expect(firstStamp).toBeTruthy();

    // Second event with a DIFFERENT refund id arrives later (the kind
    // of out-of-order replay Clover does). The receiver must see
    // status='refunded' and skip the write.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = await postSigned({
      id: 'evt_db_refund_dup_2',
      type: 'refund.created',
      data: { object: { id: uniqueDisputeId('rfnd2'), charge: chargeId } },
    });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body?.data?.ignored).toBe('already_refunded');

    const afterSecond = await storage.getPaymentById(payment.id);
    expect(afterSecond?.refundedAt).toBe(firstStamp);
    expect(afterSecond?.squareRefundId).toBe(firstRefundId);
  });

  it('a duplicate / out-of-order dispute event does not re-stamp disputedAt on the real row', async () => {
    const chargeId = uniqueChargeId('dispute_dup');
    const payment = await seedPaidPayment(chargeId);

    const firstDisputeId = uniqueDisputeId('disp1');
    const first = await postSigned({
      id: 'evt_db_dispute_dup_1',
      type: 'dispute.created',
      data: { object: { id: firstDisputeId, charge: chargeId } },
    });
    expect(first.status).toBe(200);

    const afterFirst = await storage.getPaymentById(payment.id);
    expect(afterFirst?.status).toBe('disputed');
    const firstStamp = afterFirst?.disputedAt;
    expect(firstStamp).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = await postSigned({
      id: 'evt_db_dispute_dup_2',
      type: 'dispute.created',
      data: { object: { id: uniqueDisputeId('disp2'), charge: chargeId } },
    });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body?.data?.ignored).toBe('already_disputed');

    const afterSecond = await storage.getPaymentById(payment.id);
    expect(afterSecond?.disputedAt).toBe(firstStamp);
    expect(afterSecond?.disputeId).toBe(firstDisputeId);
  });

  it('a dispute event arriving after refund does not overwrite the terminal refunded state', async () => {
    const chargeId = uniqueChargeId('refund_then_dispute');
    const payment = await seedPaidPayment(chargeId);

    // Refund lands first.
    const refundProviderId = uniqueDisputeId('rfnd_first');
    const refund = await postSigned({
      id: 'evt_db_refund_then_dispute_1',
      type: 'refund.created',
      data: { object: { id: refundProviderId, charge: chargeId } },
    });
    expect(refund.status).toBe(200);

    const afterRefund = await storage.getPaymentById(payment.id);
    expect(afterRefund?.status).toBe('refunded');
    expect(afterRefund?.disputedAt).toBeNull();
    expect(afterRefund?.disputeId).toBeNull();

    // Out-of-order dispute arrives after refund. Receiver should ack
    // and ignore — the row stays `refunded` and dispute fields stay null.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const dispute = await postSigned({
      id: 'evt_db_refund_then_dispute_2',
      type: 'dispute.created',
      data: { object: { id: uniqueDisputeId('disp_after_refund'), charge: chargeId } },
    });
    expect(dispute.status).toBe(200);
    const body = await dispute.json();
    expect(body?.data?.ignored).toBe('already_refunded');

    const afterDispute = await storage.getPaymentById(payment.id);
    expect(afterDispute?.status).toBe('refunded');
    expect(afterDispute?.disputedAt).toBeNull();
    expect(afterDispute?.disputeId).toBeNull();
    expect(afterDispute?.refundedAt).toBe(afterRefund?.refundedAt);
    expect(afterDispute?.squareRefundId).toBe(refundProviderId);
  });

  it('a webhook for a charge id we do not own does not mutate any row', async () => {
    const chargeId = uniqueChargeId('untouched');
    const payment = await seedPaidPayment(chargeId);
    const before = await storage.getPaymentById(payment.id);

    const res = await postSigned({
      id: 'evt_db_unknown',
      type: 'refund.created',
      data: {
        object: { id: uniqueDisputeId('unknown'), charge: uniqueChargeId('not_in_db') },
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body?.data?.ignored).toBe('unknown_charge');

    const after = await storage.getPaymentById(payment.id);
    expect(after?.status).toBe(before?.status);
    expect(after?.refundedAt).toBe(before?.refundedAt);
    expect(after?.disputedAt).toBe(before?.disputedAt);
  });

  it('an unknown event type does not mutate any row', async () => {
    const chargeId = uniqueChargeId('unknown_type');
    const payment = await seedPaidPayment(chargeId);
    const before = await storage.getPaymentById(payment.id);

    const res = await postSigned({
      id: 'evt_db_unknown_type',
      type: 'customer.subscription.unicorn',
      data: { object: { id: 'whatever', charge: chargeId } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body?.data?.ignored).toBe('unknown_event_type');

    const after = await storage.getPaymentById(payment.id);
    expect(after?.status).toBe(before?.status);
    expect(after?.refundedAt).toBe(before?.refundedAt);
    expect(after?.disputedAt).toBe(before?.disputedAt);
  });

  it('rejects an unsigned request even when the payment exists (signature gate is engaged)', async () => {
    const chargeId = uniqueChargeId('unsigned');
    const payment = await seedPaidPayment(chargeId);

    const res = await fetch(`${baseUrl}/api/payments-provider/webhooks/clover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'evt_db_unsigned',
        type: 'refund.created',
        data: { object: { id: uniqueDisputeId('rfnd_unsigned'), charge: chargeId } },
      }),
    });
    expect(res.status).toBe(401);

    const after = await storage.getPaymentById(payment.id);
    expect(after?.status).toBe('paid');
    expect(after?.refundedAt).toBeNull();
  });
});
