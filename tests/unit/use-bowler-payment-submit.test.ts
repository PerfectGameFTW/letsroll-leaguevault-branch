import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Bowler, League } from '@shared/schema';

const {
  toastMock,
  csrfFetchMock,
  invalidateQueriesMock,
  createPaymentMock,
  tokenizeCardMock,
  providerState,
} = vi.hoisted(() => ({
  toastMock: vi.fn(),
  csrfFetchMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  createPaymentMock: vi.fn(),
  tokenizeCardMock: vi.fn(),
  // Per-test override hook for the active provider returned by
  // `usePaymentProvider`. The catch block in
  // `useBowlerPaymentSubmit` reads `isClover` to decide whether the
  // PROVIDER_NOT_CONFIGURED toast names "Clover" or "Square"
  // (task #610). Default to Square so the existing success-path
  // tests behave as before.
  providerState: { isClover: false },
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

vi.mock('@/hooks/use-payment-provider', () => ({
  usePaymentProvider: () => ({
    isClover: providerState.isClover,
    isSquare: !providerState.isClover,
  }),
  clearProviderConfigCache: () => {},
}));

// Mock the toast helper so the test can pin the exact `provider`
// argument the hook forwards (rather than constructing the JSX
// `ToastAction` and asserting on serialized output). This is the
// real wiring contract for #610: the hook MUST pass the location's
// active provider, not let the helper's default ("square") win.
const { providerNotConfiguredToastMock } = vi.hoisted(() => ({
  providerNotConfiguredToastMock: vi.fn(),
}));

vi.mock('@/lib/provider-not-configured', async () => {
  const actual = await vi.importActual<typeof import('../../client/src/lib/provider-not-configured')>(
    '../../client/src/lib/provider-not-configured',
  );
  return {
    ...actual,
    providerNotConfiguredToast: (
      opts: NonNullable<Parameters<typeof actual.providerNotConfiguredToast>[0]> = {},
    ) => {
      providerNotConfiguredToastMock(opts);
      // Return a sentinel so the hook's `toast(...)` call still has a
      // real-shaped object to forward and the test can assert on the
      // toast-mock's `title` if it wants to.
      return {
        title: `${opts.provider === 'clover' ? 'Clover' : 'Square'} isn't connected for this location`,
        variant: 'destructive' as const,
      };
    },
  };
});

import { useBowlerPaymentSubmit } from '@/hooks/use-bowler-payment-submit';

type SubmitOpts = Parameters<typeof useBowlerPaymentSubmit>[0];

interface FakeResponse {
  ok: boolean;
  json: () => Promise<unknown>;
}

function jsonResponse(body: unknown, ok = true): Promise<FakeResponse> {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

function makeLeague(paymentMode: 'pay-as-you-go' | 'upfront' = 'pay-as-you-go'): League {
  return { id: 'league-1', paymentMode } as unknown as League;
}

function makeBowler(): Bowler {
  return { id: 'bowler-1' } as unknown as Bowler;
}

function makeCard(): NonNullable<SubmitOpts['card']> {
  // The hook only checks `card` is truthy at the cardMode==='new' gate;
  // the real shape doesn't matter because tokenizeCard is mocked.
  return { token: 'unused' } as unknown as NonNullable<SubmitOpts['card']>;
}

function makeOptions(overrides: Partial<SubmitOpts> = {}): SubmitOpts {
  const base: SubmitOpts = {
    league: makeLeague(),
    bowler: makeBowler(),
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
  // Default to Square so success-path tests stay legacy-shaped.
  // The PROVIDER_NOT_CONFIGURED test below opts back into Clover.
  providerState.isClover = false;
  providerNotConfiguredToastMock.mockReset();
});

describe('useBowlerPaymentSubmit success toasts', () => {
  it('shows the custom one-time payment success toast with formatted amount', async () => {
    csrfFetchMock.mockResolvedValueOnce(await jsonResponse({ data: { id: 'pmt-1' } }));

    const submit = useBowlerPaymentSubmit(
      makeOptions({
        league: makeLeague('pay-as-you-go'),
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
        league: makeLeague('upfront'),
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

// Task #610: bowler-facing payment submission was the last
// PROVIDER_NOT_CONFIGURED toast site that still hard-coded a Square
// label even on Clover-only locations. Pin both the Clover and Square
// branches so a future refactor of `useBowlerPaymentSubmit` can't
// silently regress to "Square isn't connected" on Clover leagues.
describe('useBowlerPaymentSubmit PROVIDER_NOT_CONFIGURED toast (#610)', () => {
  // Helper: drive the upfront-with-new-card branch so the catch block
  // sees a structured error from `throwApiErrorIfNotOk`. The
  // `/api/payments-provider/cards/:bowlerId` POST is the only call in
  // the upfront flow that funnels its non-OK body through
  // `makeApiError`, which is what preserves the
  // PROVIDER_NOT_CONFIGURED code for `isProviderNotConfiguredError`.
  async function triggerNotConfigured() {
    tokenizeCardMock.mockResolvedValueOnce('cnon:fake-token');
    csrfFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: () =>
        Promise.resolve({
          error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'Provider not connected' },
        }),
    });

    const submit = useBowlerPaymentSubmit(
      makeOptions({
        league: makeLeague('upfront'),
        // Force the new-card path so the save-card endpoint runs
        // (saved-card path short-circuits past the fetch).
        cardMode: 'new',
        card: makeCard(),
        selectedSavedCardId: '',
      }),
    );
    await submit();
  }

  it('forwards provider:"clover" to providerNotConfiguredToast when usePaymentProvider returns clover', async () => {
    providerState.isClover = true;

    await triggerNotConfigured();

    // Pin the wiring contract directly: the hook MUST forward the
    // resolved provider so the helper can render "Clover isn't
    // connected …" instead of falling back to its 'square' default.
    expect(providerNotConfiguredToastMock).toHaveBeenCalledTimes(1);
    expect(providerNotConfiguredToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'clover' }),
    );

    // Belt-and-suspenders: the toast that actually fires must say Clover.
    const { title, variant } = lastToast();
    expect(variant).toBe('destructive');
    expect(title).toBe("Clover isn't connected for this location");
    expect(title).not.toMatch(/Square/);
  });

  it('forwards provider:"square" when usePaymentProvider returns square', async () => {
    providerState.isClover = false;

    await triggerNotConfigured();

    expect(providerNotConfiguredToastMock).toHaveBeenCalledTimes(1);
    expect(providerNotConfiguredToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'square' }),
    );
    expect(lastToast().title).toBe("Square isn't connected for this location");
  });
});
