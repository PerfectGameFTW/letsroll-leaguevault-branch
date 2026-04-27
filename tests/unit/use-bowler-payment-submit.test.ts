import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Bowler, League } from '@shared/schema';

const {
  toastMock,
  csrfFetchMock,
  invalidateQueriesMock,
  createPaymentMock,
  tokenizeCardMock,
} = vi.hoisted(() => ({
  toastMock: vi.fn(),
  csrfFetchMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  createPaymentMock: vi.fn(),
  tokenizeCardMock: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useCallback: <T>(fn: T): T => fn };
});

// The hook calls `useLocation()` from wouter so it can pass `navigate`
// into `providerNotConfiguredToast` in its catch block. This test invokes
// the hook as a plain function (the `useCallback` mock above strips React's
// hook context), so we likewise neutralize wouter's hook here. Without
// this, wouter's real `useLocation` triggers React's "Invalid hook call"
// guard and every test in this file fails before reaching its assertion.
vi.mock('wouter', () => ({
  useLocation: () => ['/test', vi.fn()] as const,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock('@/lib/queryClient', () => ({
  csrfFetch: csrfFetchMock,
  queryClient: { invalidateQueries: invalidateQueriesMock },
}));

vi.mock('@/lib/square', () => ({
  createPayment: createPaymentMock,
  tokenizeCard: tokenizeCardMock,
}));

import { useBowlerPaymentSubmit } from '@/hooks/use-bowler-payment-submit';

type SubmitOpts = Parameters<typeof useBowlerPaymentSubmit>[0];

interface FakeResponse {
  ok: boolean;
  json: () => Promise<unknown>;
}

function jsonResponse(body: unknown, ok = true): Promise<FakeResponse> {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function makeOptions(overrides: Partial<SubmitOpts> = {}): SubmitOpts {
  const base: SubmitOpts = {
    league: { id: 'league-1', paymentMode: 'pay-as-you-go' } as unknown as League,
    bowler: { id: 'bowler-1' } as unknown as Bowler,
    weeklyFee: 2000,
    card: null,
    cardMode: 'saved',
    selectedSavedCardId: 'card-1',
    selectedSchedule: 'weekly',
    storeCard: false,
    includeFinalTwoWeeks: false,
    showFinalTwoWeeksWarning: false,
    financials: {
      fullSeasonAmount: 30000,
      finalTwoWeeks: { amount: 4000, dueByWeek: 14, isPaid: true },
      amountPastDue: 0,
    },
    calculateTotalAmount: () => 2000,
    setIsSubmitting: vi.fn(),
    setShowFinalTwoWeeksWarning: vi.fn(),
    setIncludeFinalTwoWeeks: vi.fn(),
    setShowPaymentSetup: vi.fn(),
  };
  return { ...base, ...overrides };
}

interface ToastArg {
  title: string;
  description: string;
  variant?: string;
}

function lastToast(): ToastArg {
  const calls = toastMock.mock.calls;
  if (calls.length === 0) throw new Error('expected toast to have been called');
  return calls[calls.length - 1][0] as ToastArg;
}

beforeEach(() => {
  toastMock.mockReset();
  csrfFetchMock.mockReset();
  invalidateQueriesMock.mockReset();
  createPaymentMock.mockReset();
  tokenizeCardMock.mockReset();
});

describe('useBowlerPaymentSubmit success toasts', () => {
  it('shows the custom one-time payment success toast with formatted amount', async () => {
    csrfFetchMock.mockResolvedValueOnce(await jsonResponse({ data: { id: 'pmt-1' } }));

    const submit = useBowlerPaymentSubmit(
      makeOptions({
        league: { id: 'league-1', paymentMode: 'pay-as-you-go' } as unknown as League,
        selectedSchedule: 'custom',
        calculateTotalAmount: () => 5000,
      }),
    );

    await submit();

    expect(toastMock).toHaveBeenCalledTimes(1);
    const { title, description, variant } = lastToast();
    expect(variant).toBeUndefined();
    expect(title).toBe('Payment Successful');
    expect(description).toBe('Your payment of $50.00 has been processed.');
    expect(description).not.toMatch(/selectedSchedule/);
  });

  it('includes the Final 2 Weeks note when the user opted in', async () => {
    csrfFetchMock.mockResolvedValueOnce(await jsonResponse({ data: { id: 'pmt-1' } }));

    const submit = useBowlerPaymentSubmit(
      makeOptions({
        selectedSchedule: 'custom',
        includeFinalTwoWeeks: true,
        calculateTotalAmount: () => 9000,
      }),
    );

    await submit();

    const { title, description } = lastToast();
    expect(title).toBe('Payment Successful');
    expect(description).toBe('Payment of $90.00 processed (includes Final 2 Weeks).');
  });

  it('shows the upfront full-season scheduled toast', async () => {
    csrfFetchMock.mockResolvedValueOnce(await jsonResponse({ ok: true }));

    const submit = useBowlerPaymentSubmit(
      makeOptions({
        league: { id: 'league-1', paymentMode: 'upfront' } as unknown as League,
      }),
    );

    await submit();

    expect(toastMock).toHaveBeenCalledTimes(1);
    const { title, description } = lastToast();
    expect(title).toBe('Payment Scheduled');
    expect(description).toBe(
      'Your card has been saved and your full season payment of $300.00 will be processed momentarily.',
    );
  });

  it('shows the auto-pay no-balance toast that does not mention a charge today', async () => {
    csrfFetchMock.mockResolvedValueOnce(await jsonResponse({ ok: true }));

    const submit = useBowlerPaymentSubmit(
      makeOptions({
        selectedSchedule: 'weekly',
        financials: {
          fullSeasonAmount: 30000,
          finalTwoWeeks: { amount: 0, dueByWeek: 14, isPaid: true },
          amountPastDue: 0,
        },
        calculateTotalAmount: () => 2000,
      }),
    );

    await submit();

    expect(toastMock).toHaveBeenCalledTimes(1);
    const { title, description } = lastToast();
    expect(title).toBe('Auto-Pay Activated');
    expect(description).toBe('Your card has been saved and weekly auto-pay is now active.');
    expect(description).not.toMatch(/Paid \$/);
    expect(description).not.toMatch(/today/);
    expect(description).not.toMatch(/selectedSchedule/);
  });

  it('shows the auto-pay with-balance toast that splits the past-due charge from the schedule', async () => {
    csrfFetchMock
      .mockResolvedValueOnce(await jsonResponse({ data: { id: 'pmt-1' } }))
      .mockResolvedValueOnce(await jsonResponse({ ok: true }));

    const submit = useBowlerPaymentSubmit(
      makeOptions({
        selectedSchedule: 'weekly',
        financials: {
          fullSeasonAmount: 30000,
          finalTwoWeeks: { amount: 0, dueByWeek: 14, isPaid: true },
          amountPastDue: 6000,
        },
        calculateTotalAmount: () => 8000,
      }),
    );

    await submit();

    expect(toastMock).toHaveBeenCalledTimes(1);
    const { title, description } = lastToast();
    expect(title).toBe('Auto-Pay Activated');
    expect(description).toBe(
      'Paid $80.00 today and weekly auto-pay is now active for future weeks.',
    );
    expect(description).not.toBe('Your card has been saved and weekly auto-pay is now active.');
  });
});
