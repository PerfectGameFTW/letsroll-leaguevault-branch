/**
 * Task #633 — Clover autopay failure-path coverage.
 *
 * Sibling to `tests/unit/square-autopay-failures.test.ts` (same task)
 * and unattended-charge analog of `tests/unit/clover-charge-failures
 * .test.ts` (Task #578, interactive `POST /api/payments-provider/
 * payments`). The autopay path lives in `server/services/payment-
 * execution.ts::executeScheduledPayment` and is provider-agnostic —
 * but the admin-visible signal (the `notes` column on the inserted
 * `payments` row, written by `payment-lifecycle.ts::handleFailed
 * Payment` as `"Failed payment: …"`) is the same for Clover, and a
 * future regression in either provider's catch-routing — or in the
 * shared `executeCharge` helper — would silently corrupt this admin
 * audit field. Mirroring this test against a Clover provider stub
 * matches the existing `square-charge-failures.test.ts` /
 * `clover-charge-failures.test.ts` pair and pins both providers'
 * end-to-end autopay contracts independently.
 *
 * The Task #605 test (`tests/unit/payment-execution-error-mapping.test
 * .ts`) already pins the `executeCharge` return-shape for typed
 * errors. This file goes one level higher and drives `process
 * ScheduledPaymentJob` end-to-end with a mocked DB and a stubbed
 * Clover provider, captures the row passed to `db.insert(payments)
 * .values(...)`, and pins the same three end-to-end branches the
 * Square sibling pins:
 *
 *   1. Typed `PaymentProviderError(PAYMENT_DECLINED)` thrown by the
 *      provider → `row.notes` carries the human-readable decline
 *      sentence, NOT a generic wall, NOT the upstream `detail`
 *      (e.g. `card_declined: do_not_honor`).
 *   2. `ProviderNotConfiguredError` thrown from `getPaymentProvider`
 *      at provider-resolution time → `row.notes` carries the
 *      canonical "Payment provider is not configured for this
 *      location" sentence (a distinct admin signal, never confused
 *      with a card decline, and never embedding the raw location id).
 *   3. A bare untyped `Error` from the provider → `row.notes` does
 *      NOT leak the raw `error.message` or stack-trace fragment.
 *      The sanitizer in `buildPaymentErrorResponse` swaps it for
 *      the generic safe sentence.
 *
 * Both the `processPayment` (no line items) and `createOrderWith
 * Payment` (with line items) branches funnel through the same
 * shared helper inside `executeCharge` — exercising both makes
 * sure a future "let's only wrap one branch" refactor is caught
 * here, not by an admin staring at an opaque audit row in prod.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaymentSchedule } from '@shared/schema';

interface DbState {
  league: Record<string, unknown>;
  bowler: Record<string, unknown>;
  insertedRows: Record<string, unknown>[];
}

const dbState: DbState = {
  league: {},
  bowler: {},
  insertedRows: [],
};

vi.mock('../../server/db', async () => {
  const { leagues, bowlers } = await import('@shared/schema');
  return {
    db: {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([{ id: 333 }]),
          }),
        }),
      }),
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === leagues) return Promise.resolve([dbState.league]);
            if (table === bowlers) return Promise.resolve([dbState.bowler]);
            return Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          dbState.insertedRows.push(v);
          return Promise.resolve();
        },
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    },
  };
});

const mockGetPaymentProvider = vi.fn();
vi.mock('../../server/services/payment-provider-factory', async () => {
  const actual = await vi.importActual<
    typeof import('../../server/services/payment-provider-factory')
  >('../../server/services/payment-provider-factory');
  return {
    ...actual,
    getPaymentProvider: (...a: unknown[]) => mockGetPaymentProvider(...a),
  };
});

vi.mock('../../server/services/payment-checks', () => ({
  checkPaidInFull: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../server/storage', () => ({
  storage: {
    updatePaymentScheduleFields: vi.fn(),
    deactivatePaymentSchedule: vi.fn(),
  },
}));

vi.mock('../../server/utils/league-datetime.js', () => ({
  getNextLeagueDateTime: () => new Date('2026-05-01T19:00:00.000Z'),
}));

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../server/logger', () => ({
  logger: fakeLogger,
  createLogger: () => fakeLogger,
}));

const { processScheduledPaymentJob } = await import('../../server/services/payment-lifecycle');
const {
  PaymentProviderError,
  ProviderNotConfiguredError,
  GENERIC_PAYMENT_USER_MESSAGE,
} = await import('../../server/services/payment-provider-factory');
const { PROVIDER_NOT_CONFIGURED_USER_MESSAGE } = await import(
  '../../server/utils/payment-error-response'
);

const mockCloverProvider = {
  providerName: 'clover' as const,
  locationId: 99,
  processPayment: vi.fn(),
  createOrderWithPayment: vi.fn(),
  refundPayment: vi.fn(),
  saveCardOnFile: vi.fn(),
  listCardsOnFile: vi.fn(),
  disableCard: vi.fn(),
  createOrUpdateCustomer: vi.fn(),
  getPayment: vi.fn(),
  validateCardId: vi.fn().mockReturnValue(false),
};

const baseSchedule: PaymentSchedule = {
  id: 333,
  bowlerId: 42,
  leagueId: 11,
  amount: 2000,
  frequency: 'weekly',
  paymentCardId: 'clv_card_token_abcdef',
  nextPaymentDate: '2026-04-22T19:00:00.000Z',
  lastPaymentDate: null,
  active: true,
  createdAt: '2026-04-01T00:00:00.000Z',
  cancelledAt: null,
  cancelReason: null,
};

const callbacks = {
  schedulePayment: vi.fn(),
  cancelJob: vi.fn(),
};

beforeEach(() => {
  dbState.insertedRows.length = 0;
  // Default league: no catalog item ids → executeCharge takes the
  // processPayment (no line items) branch by default. Order-flow
  // specs override `lineageItemVariationId` / `prizeFundItem
  // VariationId` in their own beforeEach. (Clover charge IDs differ
  // from Square's but the line-item plumbing in `buildLineItems` is
  // provider-agnostic.)
  dbState.league = {
    id: 11,
    organizationId: 1,
    weeklyFee: 2000,
    lineageFee: 0,
    prizeFundFee: 0,
    seasonStart: '2026-01-01',
    seasonEnd: '2026-04-01',
    totalBowlingWeeks: 12,
    cancelledDates: [],
    skipDates: [],
    doublePayDates: [],
    paymentMode: 'recurring',
    timezone: 'America/Chicago',
    weekDay: 3,
    competitionStartTime: '19:00',
    locationId: 99,
    lineageItemVariationId: null,
    prizeFundItemVariationId: null,
  };
  dbState.bowler = {
    id: 42,
    name: 'Pat',
    email: 'pat@example.com',
    paymentCustomerId: 'cv_cust_1',
  };

  mockGetPaymentProvider.mockReset().mockResolvedValue(mockCloverProvider);
  mockCloverProvider.processPayment.mockReset();
  mockCloverProvider.createOrderWithPayment.mockReset();
  mockCloverProvider.validateCardId.mockReset().mockReturnValue(false);
  fakeLogger.info.mockReset();
  fakeLogger.warn.mockReset();
  fakeLogger.error.mockReset();
  fakeLogger.debug.mockReset();
  callbacks.schedulePayment.mockReset();
  callbacks.cancelJob.mockReset();
});

describe('processScheduledPaymentJob — Clover autopay failure paths (Task #633)', () => {
  describe('processPayment branch (no catalog line items on the league)', () => {
    it('persists the human-readable decline reason when the provider raises a typed PAYMENT_DECLINED', async () => {
      // Clover's processPayment 402 branch (see clover-provider.ts /
      // mapApiError) already maps to this typed shape — pinning that
      // the autopay catch surfaces the typed `userMessage` (not the
      // upstream `detail` like 'card_declined: do_not_honor', and
      // not a generic wall) into the `payments.notes` column.
      mockCloverProvider.processPayment.mockRejectedValue(
        new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          'card_declined: do_not_honor',
        ),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-decline', callbacks);

      expect(mockCloverProvider.processPayment).toHaveBeenCalledTimes(1);
      expect(mockCloverProvider.createOrderWithPayment).not.toHaveBeenCalled();
      expect(dbState.insertedRows).toHaveLength(1);

      const row = dbState.insertedRows[0];
      expect(row).toMatchObject({
        bowlerId: 42,
        leagueId: 11,
        amount: 2000,
        status: 'failed',
        weekOf: baseSchedule.nextPaymentDate,
      });
      expect(row.notes).toBe(
        'Failed payment: Your payment was declined. Please try a different card.',
      );
      // Upstream `detail` (raw provider code) must never leak into
      // the admin-visible audit field — that's server-log-only.
      expect(row.notes).not.toContain('do_not_honor');
      expect(row.notes).not.toContain('card_declined');
      // Hard-pin against the regression this task was filed to
      // prevent: a future refactor swapping the typed reason for a
      // generic "Autopay failed" string.
      expect(row.notes).not.toContain('Autopay failed');
      expect(callbacks.schedulePayment).not.toHaveBeenCalled();
      expect(fakeLogger.error).toHaveBeenCalled();
    });

    it('falls back to the sanitized generic sentence for a bare untyped Error (no stack-trace leak)', async () => {
      mockCloverProvider.processPayment.mockRejectedValue(
        new Error(
          'boom: undefined is not a function\n  at /server/services/clover.ts:123',
        ),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-untyped', callbacks);

      expect(dbState.insertedRows).toHaveLength(1);
      const row = dbState.insertedRows[0];
      expect(row.notes).toBe(`Failed payment: ${GENERIC_PAYMENT_USER_MESSAGE}`);
      expect(row.notes).not.toContain('boom');
      expect(row.notes).not.toContain('clover.ts');
      expect(row.notes).not.toContain('undefined is not a function');
    });

    it('scrubs JSON-shaped userMessage through sanitizePaymentUserMessage before persisting', async () => {
      mockCloverProvider.processPayment.mockRejectedValue(
        new PaymentProviderError(
          '{"error":{"message":"raw clover payload","code":"oops"}}',
          'PAYMENT_DECLINED',
          'should never reach the user',
        ),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-json', callbacks);

      expect(dbState.insertedRows).toHaveLength(1);
      const row = dbState.insertedRows[0];
      expect(row.notes).toBe(`Failed payment: ${GENERIC_PAYMENT_USER_MESSAGE}`);
      expect(row.notes).not.toContain('{');
      expect(row.notes).not.toContain('raw clover payload');
    });
  });

  describe('createOrderWithPayment branch (league has catalog item ids)', () => {
    beforeEach(() => {
      dbState.league = {
        ...dbState.league,
        lineageItemVariationId: 'cv_var_lineage',
        prizeFundItemVariationId: 'cv_var_prize',
      };
    });

    it('persists the human-readable decline reason when createOrderWithPayment raises a typed PAYMENT_DECLINED', async () => {
      mockCloverProvider.createOrderWithPayment.mockRejectedValue(
        new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          'card_declined: do_not_honor',
        ),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-decline-order', callbacks);

      // With line items present, processPayment must NOT be reached.
      expect(mockCloverProvider.processPayment).not.toHaveBeenCalled();
      expect(mockCloverProvider.createOrderWithPayment).toHaveBeenCalledTimes(1);

      expect(dbState.insertedRows).toHaveLength(1);
      const row = dbState.insertedRows[0];
      expect(row.notes).toBe(
        'Failed payment: Your payment was declined. Please try a different card.',
      );
      expect(row.notes).not.toContain('Autopay failed');
      expect(row.notes).not.toContain('do_not_honor');
    });

    it('scrubs an untyped Error stack so no provider internals leak through the order branch', async () => {
      mockCloverProvider.createOrderWithPayment.mockRejectedValue(
        new Error('order create failed\n  at /server/services/clover.ts:540'),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-untyped-order', callbacks);

      expect(dbState.insertedRows).toHaveLength(1);
      const row = dbState.insertedRows[0];
      expect(row.notes).toBe(`Failed payment: ${GENERIC_PAYMENT_USER_MESSAGE}`);
      expect(row.notes).not.toContain('order create failed');
      expect(row.notes).not.toContain('clover.ts');
    });
  });

  describe('ProviderNotConfiguredError raised at provider-resolution time', () => {
    it('persists the canonical not-configured sentence (distinct from a card decline, no location-id leak)', async () => {
      // PNCE is thrown from `getPaymentProvider` (not from
      // executeCharge itself) on the autopay path — caught by
      // executeScheduledPayment's top-level try/catch and routed
      // through `buildPaymentErrorResponse`. The raw PNCE message
      // embeds the location id ("Clover is not configured for
      // location 99") and must NEVER appear in the admin notes;
      // routing through the helper guarantees that.
      mockGetPaymentProvider.mockReset().mockRejectedValue(
        new ProviderNotConfiguredError('Clover is not configured for location 99', 99),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-pnce', callbacks);

      expect(dbState.insertedRows).toHaveLength(1);
      const row = dbState.insertedRows[0];
      expect(row.notes).toBe(`Failed payment: ${PROVIDER_NOT_CONFIGURED_USER_MESSAGE}`);
      // Distinct from the card-decline sentence so admins can tell
      // at a glance whether the failure is a card problem or a
      // config problem.
      expect(row.notes).not.toContain('declined');
      expect(row.notes).not.toContain('different card');
      // Raw PNCE message — which embeds the location id — never
      // leaks into the admin-visible field.
      expect(row.notes).not.toContain('location 99');
      expect(row.notes).not.toContain('Clover is not configured');
      // Provider was never reached — no charge attempts occurred.
      expect(mockCloverProvider.processPayment).not.toHaveBeenCalled();
      expect(mockCloverProvider.createOrderWithPayment).not.toHaveBeenCalled();
    });
  });
});
