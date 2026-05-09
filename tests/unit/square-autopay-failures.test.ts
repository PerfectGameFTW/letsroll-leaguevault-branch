/**
 * Task #633 — Square autopay failure-path coverage.
 *
 * Unattended-charge analog of `tests/unit/square-charge-failures.test.ts`
 * (Task #619, interactive `POST /api/payments-provider/payments`). The
 * autopay path lives in `server/services/payment-execution.ts::execute
 * ScheduledPayment` and surfaces its admin-visible signal as the
 * `notes` column on the inserted `payments` row ("Failed payment: …" —
 * see `payment-lifecycle.ts::handleFailedPayment`), not as an HTTP body.
 * That's a different surface from the route's JSON envelope, so a
 * future refactor of the autopay catches could silently regress what
 * admins actually see in the failed-charge audit row (e.g. swap the
 * actionable "Your payment was declined." reason for a generic
 * "Autopay failed" wall, or leak a stack-trace fragment from a bare
 * Error) without any of the existing route-layer tests catching it.
 *
 * The Task #605 test (`tests/unit/payment-execution-error-mapping.test
 * .ts`) already pins the `executeCharge` return-shape for both
 * `processPayment` and `createOrderWithPayment` branches. This file
 * goes one level higher and drives `processScheduledPaymentJob` end-
 * to-end with a mocked DB and a stubbed Square provider, captures the
 * row passed to `db.insert(payments).values(...)`, and pins three
 * end-to-end branches:
 *
 *   1. Typed `PaymentProviderError(PAYMENT_DECLINED)` thrown by the
 *      provider → `row.notes` carries the human-readable decline
 *      sentence (NOT a generic wall, NOT the upstream `detail` like
 *      `CARD_DECLINED`).
 *   2. `ProviderNotConfiguredError` thrown from `getPaymentProvider`
 *      at provider-resolution time → `row.notes` carries the canonical
 *      "Payment provider is not configured for this location" sentence
 *      (a distinct admin signal, never confused with a card decline,
 *      and never embedding the raw location id).
 *   3. A bare untyped `Error` from the provider → `row.notes` does NOT
 *      leak the raw `error.message` or stack-trace fragment. The
 *      sanitizer in `buildPaymentErrorResponse` swaps it for the
 *      generic safe sentence.
 *
 * Both the `lineItems.length === 0` (`processPayment`) and
 * `lineItems.length > 0` (`createOrderWithPayment`) branches funnel
 * through the same shared helper inside `executeCharge` — exercising
 * both makes sure a future "let's only wrap one branch" refactor is
 * caught here, not by an admin staring at an opaque audit row in prod.
 *
 * Sibling: `tests/unit/clover-autopay-failures.test.ts` (same task)
 * mirrors this against a Clover provider stub. The autopay code is
 * provider-agnostic, but mirroring the file shape matches the existing
 * `square-charge-failures.test.ts` / `clover-charge-failures.test.ts`
 * pair and makes a future provider-specific divergence (e.g. one
 * provider's catch routing a different fallback string) impossible to
 * miss.
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
  // Resolve the actual table references inside the factory so the
  // `from(table)` discriminator below uses the same identity the
  // production code passes in. Fetching them lazily here avoids
  // hoisting headaches (top-level imports run after `vi.mock` calls).
  const { leagues, bowlers } = await import('@shared/schema');
  return {
    db: {
      // `update(paymentSchedules).set(...).where(...).returning(...)` —
      // the lifecycle's "claim this scheduled job" guard. Returning a
      // non-empty array keeps the lifecycle from short-circuiting at
      // its `claimed.length === 0` warn branch.
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([{ id: 333 }]),
          }),
        }),
      }),
      // `select().from(<table>).where(...)` is awaited as a Promise of
      // rows, then `.then(r => r[0])` picks the first. We discriminate
      // on the table identity so leagues / bowlers each return their
      // own fixture without coupling to call order.
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            // Task #678: lifecycle now resolves the payer user via
            // `getUserByBowlerId(...)` which calls `.where(...).limit(1)`,
            // while older callers just await `.where(...)`. Return a
            // thenable that ALSO exposes `.limit(...)` so both shapes
            // work without per-call branching.
            const rows =
              table === leagues
                ? [dbState.league]
                : table === bowlers
                  ? [dbState.bowler]
                  : [];
            const p = Promise.resolve(rows);
            return Object.assign(p, { limit: () => Promise.resolve(rows) });
          },
        }),
      }),
      // `db.insert(payments).values(...)` — the failed-payment row
      // insert from `handleFailedPayment`. Capture every value bag so
      // each spec can assert on the persisted `notes` text.
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          dbState.insertedRows.push(v);
          return Promise.resolve();
        },
      }),
      // No transaction is opened on the failure path, but the success
      // path uses one — provide a minimal stub so the import resolves
      // even though these tests never reach it.
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
  // Failure path never reaches the paid-in-full check, but the
  // import has to resolve.
  checkPaidInFull: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../server/storage', () => ({
  storage: {
    updatePaymentScheduleFields: vi.fn(),
    deactivatePaymentSchedule: vi.fn(),
  },
}));

vi.mock('../../server/utils/league-datetime.js', () => ({
  // Skip-date branch is bypassed below (skipDates / cancelledDates are
  // empty), so this is only here to keep the import resolvable.
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

const mockSquareProvider = {
  providerName: 'square' as const,
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
  paymentCardId: 'sq_card_token_abcdef',
  nextPaymentDate: '2026-04-22T19:00:00.000Z',
  lastPaymentDate: null,
  active: true,
  createdAt: '2026-04-01T00:00:00.000Z',
  additionalBowlerIds: null,
  cancelledAt: null,
  cancelReason: null,
};

const callbacks = {
  schedulePayment: vi.fn(),
  cancelJob: vi.fn(),
};

beforeEach(() => {
  dbState.insertedRows.length = 0;
  // Default league: no catalog item ids, so executeCharge takes the
  // `processPayment` (no line items) branch by default. Specs that
  // need the order-flow branch override `lineageItemVariationId` /
  // `prizeFundItemVariationId` in their own beforeEach.
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
    paymentCustomerId: 'sq_cust_1',
  };

  mockGetPaymentProvider.mockReset().mockResolvedValue(mockSquareProvider);
  mockSquareProvider.processPayment.mockReset();
  mockSquareProvider.createOrderWithPayment.mockReset();
  mockSquareProvider.validateCardId.mockReset().mockReturnValue(false);
  fakeLogger.info.mockReset();
  fakeLogger.warn.mockReset();
  fakeLogger.error.mockReset();
  fakeLogger.debug.mockReset();
  callbacks.schedulePayment.mockReset();
  callbacks.cancelJob.mockReset();
});

describe('processScheduledPaymentJob — Square autopay failure paths (Task #633)', () => {
  describe('processPayment branch (no catalog line items on the league)', () => {
    it('persists the human-readable decline reason when the provider raises a typed PAYMENT_DECLINED', async () => {
      // Square's processPayment 402 branch (see square-provider.ts)
      // already maps to this typed shape — pinning that the autopay
      // catch surfaces the typed `userMessage` (not the upstream
      // `detail` like 'CARD_DECLINED', and not a generic wall) into
      // the `payments.notes` column.
      mockSquareProvider.processPayment.mockRejectedValue(
        new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          'CARD_DECLINED',
        ),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-decline', callbacks);

      expect(mockSquareProvider.processPayment).toHaveBeenCalledTimes(1);
      expect(mockSquareProvider.createOrderWithPayment).not.toHaveBeenCalled();
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
      expect(row.notes).not.toContain('CARD_DECLINED');
      // Hard-pin against the regression this task was filed to
      // prevent: a future refactor swapping the typed reason for a
      // generic "Autopay failed" string.
      expect(row.notes).not.toContain('Autopay failed');
      // No follow-up schedule should be queued on a failure — the
      // schedule advances on the success path only.
      expect(callbacks.schedulePayment).not.toHaveBeenCalled();
      // Server-side log fires so on-call gets a signal.
      expect(fakeLogger.error).toHaveBeenCalled();
    });

    it('falls back to the sanitized generic sentence for a bare untyped Error (no stack-trace leak)', async () => {
      // If a future code path inside the provider (or one of its
      // helpers) forgets to wrap a failure in PaymentProviderError,
      // the autopay catch must still emit a friendly sentence and
      // NOT leak the raw `error.message` (which here intentionally
      // carries a stack-trace fragment) into the notes column.
      mockSquareProvider.processPayment.mockRejectedValue(
        new Error(
          'boom: undefined is not a function\n  at /server/services/square-provider.ts:231',
        ),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-untyped', callbacks);

      expect(dbState.insertedRows).toHaveLength(1);
      const row = dbState.insertedRows[0];
      // Multi-line message trips `sanitizePaymentUserMessage` →
      // generic fallback. The exact sentence is owned by the
      // sanitizer; the contract here is "no raw text leak".
      expect(row.notes).toBe(`Failed payment: ${GENERIC_PAYMENT_USER_MESSAGE}`);
      expect(row.notes).not.toContain('boom');
      expect(row.notes).not.toContain('square-provider.ts');
      expect(row.notes).not.toContain('undefined is not a function');
    });

    it('scrubs JSON-shaped userMessage through sanitizePaymentUserMessage before persisting', async () => {
      // A future regression could land a stringified JSON payload
      // on `userMessage` (e.g. someone re-introduces the pre-#514
      // "throw new Error(JSON.stringify(...))" pattern and wraps it
      // in PaymentProviderError without re-authoring the sentence).
      // The sanitizer must swap in the generic fallback so no JSON
      // fragment ever reaches the audit row.
      mockSquareProvider.processPayment.mockRejectedValue(
        new PaymentProviderError(
          '{"errors":[{"code":"CARD_DECLINED","detail":"raw square payload"}]}',
          'PAYMENT_DECLINED',
          'should never reach the user',
        ),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-json', callbacks);

      expect(dbState.insertedRows).toHaveLength(1);
      const row = dbState.insertedRows[0];
      expect(row.notes).toBe(`Failed payment: ${GENERIC_PAYMENT_USER_MESSAGE}`);
      expect(row.notes).not.toContain('{');
      expect(row.notes).not.toContain('CARD_DECLINED');
      expect(row.notes).not.toContain('raw square payload');
    });
  });

  describe('createOrderWithPayment branch (league has catalog item ids)', () => {
    beforeEach(() => {
      // Adding either lineage- or prize-fund variation IDs flips
      // executeCharge to the order-flow branch (see buildLineItems
      // in payment-execution.ts). The autopay catch is the SAME
      // shared helper, but a future "wrap only the order branch"
      // refactor would only show up here if we exercise both.
      dbState.league = {
        ...dbState.league,
        lineageItemVariationId: 'sq_var_lineage',
        prizeFundItemVariationId: 'sq_var_prize',
      };
    });

    it('persists the human-readable decline reason when createOrderWithPayment raises a typed PAYMENT_DECLINED', async () => {
      mockSquareProvider.createOrderWithPayment.mockRejectedValue(
        new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          'CARD_DECLINED',
        ),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-decline-order', callbacks);

      // With line items present, processPayment must NOT be reached.
      expect(mockSquareProvider.processPayment).not.toHaveBeenCalled();
      expect(mockSquareProvider.createOrderWithPayment).toHaveBeenCalledTimes(1);

      expect(dbState.insertedRows).toHaveLength(1);
      const row = dbState.insertedRows[0];
      expect(row.notes).toBe(
        'Failed payment: Your payment was declined. Please try a different card.',
      );
      expect(row.notes).not.toContain('Autopay failed');
      expect(row.notes).not.toContain('CARD_DECLINED');
    });

    it('scrubs an untyped Error stack so no provider internals leak through the order branch', async () => {
      mockSquareProvider.createOrderWithPayment.mockRejectedValue(
        new Error('order create failed\n  at /server/services/square-provider.ts:540'),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-untyped-order', callbacks);

      expect(dbState.insertedRows).toHaveLength(1);
      const row = dbState.insertedRows[0];
      expect(row.notes).toBe(`Failed payment: ${GENERIC_PAYMENT_USER_MESSAGE}`);
      expect(row.notes).not.toContain('order create failed');
      expect(row.notes).not.toContain('square-provider.ts');
    });
  });

  describe('ProviderNotConfiguredError raised at provider-resolution time', () => {
    it('persists the canonical not-configured sentence (distinct from a card decline, no location-id leak)', async () => {
      // PNCE is thrown from `getPaymentProvider` (not from
      // executeCharge itself) on the autopay path — caught by
      // executeScheduledPayment's top-level try/catch and routed
      // through `buildPaymentErrorResponse`. The raw PNCE message
      // embeds the location id ("Square is not configured for
      // location 99") and must NEVER appear in the admin notes;
      // routing through the helper guarantees that.
      mockGetPaymentProvider.mockReset().mockRejectedValue(
        new ProviderNotConfiguredError('Square is not configured for location 99', 99),
      );

      await processScheduledPaymentJob(baseSchedule, 'job-pnce', callbacks);

      expect(dbState.insertedRows).toHaveLength(1);
      const row = dbState.insertedRows[0];
      expect(row.notes).toBe(`Failed payment: ${PROVIDER_NOT_CONFIGURED_USER_MESSAGE}`);
      // Distinct from the card-decline sentence so admins can tell at
      // a glance whether the failure is a card problem or a config
      // problem.
      expect(row.notes).not.toContain('declined');
      expect(row.notes).not.toContain('different card');
      // Raw PNCE message — which embeds the location id — never
      // leaks into the admin-visible field.
      expect(row.notes).not.toContain('location 99');
      expect(row.notes).not.toContain('Square is not configured');
      // Provider was never reached — no charge attempts occurred.
      expect(mockSquareProvider.processPayment).not.toHaveBeenCalled();
      expect(mockSquareProvider.createOrderWithPayment).not.toHaveBeenCalled();
    });
  });
});
