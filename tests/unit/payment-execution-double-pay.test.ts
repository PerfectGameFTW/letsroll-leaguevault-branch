/**
 * Task #646 — `executeScheduledPayment` must charge 2× the league's
 * weekly fee on dates listed in `league.doublePayDates` (compared in
 * the league's local timezone) and the resulting `ChargeResult` must
 * carry a `chargedAmount` so the lifecycle persists the doubled amount
 * — not the schedule's stored `amount` — into the payment row.
 *
 * Also verifies that the no-line-items branch of `executeCharge`
 * returns `chargedAmount` on success: a missing field there used to
 * cause the lifecycle's `paymentResult.chargedAmount ?? scheduleRecord.amount`
 * fallback to silently store the un-doubled amount on autopay leagues
 * with no catalog item ids.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaymentProvider } from '../../server/services/payment-provider';
import type { PaymentSchedule } from '@shared/schema';
import { leagues } from '@shared/schema';

vi.mock('../../server/logger', () => {
  const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: fakeLogger, createLogger: () => fakeLogger };
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

vi.mock('../../server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{
          email: 'bowler@example.com',
          paymentCustomerId: 'cust_abc',
        }]),
      }),
    }),
  },
}));

const { executeScheduledPayment, executeCharge } = await import(
  '../../server/services/payment-execution'
);

type League = typeof leagues.$inferSelect;

function makeProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  const unused = (name: string) => async () => {
    throw new Error(`stub method ${name} should not be called`);
  };
  const base: PaymentProvider = {
    providerName: 'square',
    locationId: 99,
    processPayment: vi.fn(),
    createOrderWithPayment: vi.fn(),
    refundPayment: unused('refundPayment'),
    saveCardOnFile: unused('saveCardOnFile'),
    listCardsOnFile: unused('listCardsOnFile'),
    disableCard: unused('disableCard'),
    createOrUpdateCustomer: unused('createOrUpdateCustomer'),
    getPayment: unused('getPayment'),
    validateCardId: () => true,
  };
  return Object.assign(base, overrides);
}

function makeLeague(overrides: Partial<League> = {}): League {
  const base: League = {
    id: 11,
    name: 'Test League',
    description: null,
    active: true,
    allowPublicSignup: false,
    seasonStart: '2026-01-01',
    seasonEnd: '2026-04-01',
    weekDay: 'Wednesday',
    weeklyFee: 2000,
    lineageFee: 0,
    prizeFundFee: 0,
    practiceStartTime: null,
    competitionStartTime: '19:00',
    squareLineageItemId: null,
    lineageItemVariationId: null,
    squareLineageItemName: null,
    squarePrizeFundItemId: null,
    prizeFundItemVariationId: null,
    squarePrizeFundItemName: null,
    squareCategoryId: null,
    timezone: 'America/Chicago',
    finalTwoWeeksDueWeek: null,
    paymentMode: 'weekly',
    seasonNumber: 1,
    previousSeasonId: null,
    organizationId: 1,
    locationId: 99,
    totalBowlingWeeks: 12,
    skipDates: [],
    cancelledDates: [],
    doublePayDates: [],
  };
  return Object.assign(base, overrides);
}

function makeSchedule(overrides: Partial<PaymentSchedule> = {}): PaymentSchedule {
  const base: PaymentSchedule = {
    id: 333,
    bowlerId: 42,
    leagueId: 11,
    amount: 2000,
    frequency: 'weekly',
    paymentCardId: 'card_token_xyz',
    nextPaymentDate: '2026-04-22T19:00:00.000-05:00',
    lastPaymentDate: null,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    cancelledAt: null,
    cancelReason: null,
  };
  return Object.assign(base, overrides);
}

beforeEach(() => {
  mockGetPaymentProvider.mockReset();
});

describe('executeScheduledPayment — double-pay charging (Task #646)', () => {
  it('charges weeklyFee*2 and returns chargedAmount on a double-pay date (no line items)', async () => {
    const processPayment = vi.fn().mockResolvedValue({
      id: 'sq_pay_dp_1',
      providerRef: {},
    });
    mockGetPaymentProvider.mockResolvedValue(makeProvider({ processPayment }));

    const league = makeLeague({ doublePayDates: ['2026-04-22'] });
    const result = await executeScheduledPayment(makeSchedule(), league, 'job-dp-1');

    expect(result.status).toBe('success');
    expect(result.chargedAmount).toBe(4000);
    expect(processPayment).toHaveBeenCalledTimes(1);
    expect(processPayment.mock.calls[0][1]).toBe(4000);
  });

  it('charges schedule.amount on a non-double-pay date', async () => {
    const processPayment = vi.fn().mockResolvedValue({
      id: 'sq_pay_normal_1',
      providerRef: {},
    });
    mockGetPaymentProvider.mockResolvedValue(makeProvider({ processPayment }));

    const league = makeLeague({ doublePayDates: ['2026-03-25'] });
    const result = await executeScheduledPayment(makeSchedule(), league, 'job-norm-1');

    expect(result.status).toBe('success');
    expect(result.chargedAmount).toBe(2000);
    expect(processPayment).toHaveBeenCalledTimes(1);
    expect(processPayment.mock.calls[0][1]).toBe(2000);
  });

  it('matches double-pay dates in the league timezone (not UTC)', async () => {
    // The schedule fires at 2026-04-23T01:00:00Z, which in
    // America/Chicago is still 2026-04-22 (8pm). The marked
    // double-pay date is 2026-04-22 — the timezone-aware match
    // must still trigger the doubled charge.
    const processPayment = vi.fn().mockResolvedValue({
      id: 'sq_pay_tz_1',
      providerRef: {},
    });
    mockGetPaymentProvider.mockResolvedValue(makeProvider({ processPayment }));

    const tzSchedule = makeSchedule({ nextPaymentDate: '2026-04-23T01:00:00.000Z' });
    const league = makeLeague({ doublePayDates: ['2026-04-22'] });
    const result = await executeScheduledPayment(tzSchedule, league, 'job-tz-1');

    expect(result.chargedAmount).toBe(4000);
    expect(processPayment.mock.calls[0][1]).toBe(4000);
  });
});

describe('executeCharge — chargedAmount contract (Task #646)', () => {
  it('returns chargedAmount on the no-line-items processPayment success branch', async () => {
    const processPayment = vi.fn().mockResolvedValue({
      id: 'sq_pay_nli_1',
      providerRef: {},
    });
    const provider = makeProvider({ processPayment });

    const result = await executeCharge(
      provider,
      'card_token',
      1234,
      [],
      'cust_abc',
      'buyer@example.com',
    );

    expect(result.status).toBe('success');
    expect(result.chargedAmount).toBe(1234);
  });

  it('returns chargedAmount on the createOrderWithPayment success branch', async () => {
    const createOrderWithPayment = vi.fn().mockResolvedValue({
      id: 'sq_pay_li_1',
      providerRef: {},
      receiptUrl: undefined,
      receiptNumber: undefined,
    });
    const provider = makeProvider({ createOrderWithPayment });

    const result = await executeCharge(
      provider,
      'card_token',
      5678,
      [{ catalogObjectId: 'cat_1', quantity: '1' }],
      'cust_abc',
      'buyer@example.com',
    );

    expect(result.status).toBe('success');
    expect(result.chargedAmount).toBe(5678);
  });
});
