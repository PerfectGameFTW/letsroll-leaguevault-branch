/**
 * Component test for the inline "Clover isn't fully set up" alert
 * in <PaymentForm /> (task #580; pins the contract added by #575).
 *
 * Background: before #575 the checkout dialog tried to spin up the
 * Clover tokenizer regardless of whether the location had every
 * required Clover credential filled in. When `apiToken` /
 * `merchantId` / `publicTokenizerKey` / `environment` were missing
 * the user got a half-broken "Loading credit card form..." card UI
 * with no actionable explanation, the submit button stayed enabled,
 * and the eventual SDK failure surfaced a generic toast.
 *
 * #575 replaced that with:
 *   - an inline destructive Alert (data-testid
 *     `alert-clover-not-configured`) listing each missing field by
 *     its human label from `CLOVER_FIELD_LABELS`,
 *   - skipping tokenizer initialization entirely so no broken card
 *     UI is rendered,
 *   - disabling the submit button while still letting the operator
 *     pick Cash / Check as a fallback.
 *
 * The shared helper (`getMissingCloverFields`) and the
 * `/api/payments-provider/config` endpoint that feeds it are already
 * unit/integration tested. This test pins the React side end-to-end
 * so a future refactor of <PaymentForm /> can't silently re-introduce
 * the broken card UI or stop disabling submit.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Several Radix primitives reach for ResizeObserver via
// `react-use-size` — jsdom doesn't ship one, so polyfill a no-op
// before any component code runs.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = NoopResizeObserver;
}

import type { PaymentProviderConfig, RequiredProviderField } from '@/hooks/use-payment-provider';
import { CLOVER_FIELD_LABELS, type Bowler } from '@shared/schema';

// Controllable provider state per test. Default is a partially
// configured Clover location missing two of its four required
// fields — exactly the case that used to render a broken card UI.
let providerState: {
  config: PaymentProviderConfig | null;
  isLoading: boolean;
  isClover: boolean;
  isSquare: boolean;
  supportsWallets: boolean;
  isProviderConfigured: boolean;
  missingFields: RequiredProviderField[];
} = {
  config: {
    paymentProvider: 'clover',
    merchantId: 'M_PARTIAL',
    environment: 'sandbox',
    providerConfigured: false,
    missingFields: ['apiToken', 'publicTokenizerKey'],
  },
  isLoading: false,
  isClover: true,
  isSquare: false,
  supportsWallets: false,
  isProviderConfigured: false,
  missingFields: ['apiToken', 'publicTokenizerKey'],
};

vi.mock('@/hooks/use-payment-provider', () => ({
  usePaymentProvider: () => ({
    ...providerState,
    error: null,
  }),
  clearProviderConfigCache: () => {},
}));

// Stub the tokenizer hooks so jsdom doesn't try to load the real
// Square / Clover SDKs (they reach for window.Square / Clover, fetch
// remote scripts, and would explode in a unit environment). The
// PaymentForm only consumes their return shape — never the actual
// tokenization side effects in this test.
vi.mock('@/hooks/use-square-payment', () => ({
  useSquarePayment: () => ({
    card: null,
    isInitialized: false,
    error: null,
    initializeCard: vi.fn(async () => {}),
    cleanupCard: vi.fn(),
  }),
}));

const cloverInitializeCard = vi.fn(async () => {});
vi.mock('@/hooks/use-clover-payment', () => ({
  useCloverPayment: () => ({
    card: null,
    isInitialized: false,
    error: null,
    initializeCard: cloverInitializeCard,
    cleanupCard: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-wallet-payments', () => ({
  useWalletPayments: () => ({
    applePayAvailable: false,
    googlePayAvailable: false,
    applePayRef: { current: null },
    googlePayRef: { current: null },
    handleApplePayClick: vi.fn(),
    handleGooglePayClick: vi.fn(),
    isProcessing: false,
    cleanup: vi.fn(),
    applePayTokenizeOnly: false,
    googlePayTokenizeOnly: false,
  }),
}));

// The submit hook does network work under the hood — return an
// inert handler so the form renders cleanly without csrf/fetch
// plumbing in this test.
vi.mock('@/hooks/use-payment-form-submit', () => ({
  usePaymentFormSubmit: () => vi.fn(async () => {}),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/queryClient', async () => {
  const actual = await vi.importActual<typeof import('../../client/src/lib/queryClient')>(
    '../../client/src/lib/queryClient',
  );
  return {
    ...actual,
    csrfFetch: vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
    apiRequest: vi.fn(),
    queryClient: {
      invalidateQueries: vi.fn(),
    },
  };
});

vi.mock('wouter', async () => {
  const actual = await vi.importActual<typeof import('wouter')>('wouter');
  return {
    ...actual,
    useLocation: () => ['/', vi.fn()],
  };
});

import { PaymentForm } from '@/components/payment-form';

// PaymentForm only reads id / name / email off each bowler (used for
// the dropdown and the inline-receipt-email gate). Build a full,
// schema-shaped row anyway so we don't paper over future changes to
// the Bowler type with a cast.
const BOWLERS: Bowler[] = [
  {
    id: 1,
    name: 'Test Bowler',
    email: 'bowler@example.com',
    phone: null,
    active: true,
    order: 0,
    organizationId: 1,
    paymentCustomerId: null,
    cloverCustomerId: null,
    paymentProviderLocationId: null,
    bnContactId: null,
    paymentSyncPendingAt: null,
    paymentSyncAttempts: 0,
    paymentSyncLastAttemptAt: null,
    bnSyncPendingAt: null,
    bnSyncAttempts: 0,
    bnSyncLastAttemptAt: null,
  },
];

function renderForm() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PaymentForm
        open={true}
        onClose={() => {}}
        bowlers={BOWLERS}
        leagueId={7}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cloverInitializeCard.mockClear();
});

describe('<PaymentForm /> — Clover not fully configured (#580)', () => {
  it('shows the friendly Clover-not-configured Alert in place of the card UI when credentials are missing', async () => {
    providerState = {
      config: {
        paymentProvider: 'clover',
        merchantId: 'M_PARTIAL',
        environment: 'sandbox',
        providerConfigured: false,
        missingFields: ['apiToken', 'publicTokenizerKey'],
      },
      isLoading: false,
      isClover: true,
      isSquare: false,
      supportsWallets: false,
      isProviderConfigured: false,
      missingFields: ['apiToken', 'publicTokenizerKey'],
    };

    const user = userEvent.setup();
    renderForm();

    // Default tab is Cash; flip to Credit Card to hit the
    // provider-not-configured branch.
    await user.click(screen.getByRole('tab', { name: /credit card/i }));

    // 1. The dedicated Clover alert renders with the testid the
    //    rest of the system asserts against.
    const alert = await screen.findByTestId('alert-clover-not-configured');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/Clover isn't fully set up for this location/i);

    // 2. Each missing field is listed by its human label from
    //    CLOVER_FIELD_LABELS — a future relabel must be reflected
    //    in the UI or this test fails.
    expect(alert).toHaveTextContent(CLOVER_FIELD_LABELS.apiToken);
    expect(alert).toHaveTextContent(CLOVER_FIELD_LABELS.publicTokenizerKey);

    // Sanity: a field that ISN'T missing must NOT be advertised
    // as such (so we don't blame admins for already-set creds).
    const missingClause = alert.querySelector('p.text-xs')?.textContent ?? '';
    expect(missingClause).not.toContain(CLOVER_FIELD_LABELS.merchantId);
    expect(missingClause).not.toContain(CLOVER_FIELD_LABELS.environment);

    // 3. The Clover card section / tokenizer must NOT have been
    //    initialized, and the loading/card UI must NOT be in the
    //    DOM. Both are necessary: the broken-card scenario
    //    historically showed the spinner without ever actually
    //    initializing.
    expect(cloverInitializeCard).not.toHaveBeenCalled();
    expect(screen.queryByText(/Loading credit card form/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Save card for future payments/i)).not.toBeInTheDocument();

    // 4. Cash and Check tabs still exist and are clickable — the
    //    operator must have a usable fallback even when Clover is
    //    half-configured.
    const cashTab = screen.getByRole('tab', { name: /cash/i });
    const checkTab = screen.getByRole('tab', { name: /check/i });
    expect(cashTab).toBeEnabled();
    expect(checkTab).toBeEnabled();

    await user.click(checkTab);
    // The check-payment helper alert proves the tab actually
    // switched (it only renders on the Check tab).
    expect(
      await screen.findByText(/Recording a check payment/i),
    ).toBeInTheDocument();
    // The Clover alert is gone now that we're not on Credit Card.
    expect(screen.queryByTestId('alert-clover-not-configured')).not.toBeInTheDocument();

    await user.click(cashTab);
    expect(
      await screen.findByText(/Recording a cash payment/i),
    ).toBeInTheDocument();

    // 5. Submit button is disabled on Credit Card while Clover
    //    is half-configured. (It's enabled on Cash, which is fine.)
    await user.click(screen.getByRole('tab', { name: /credit card/i }));
    expect(screen.getByRole('button', { name: /submit payment/i })).toBeDisabled();
  });

  it('renders the credit card section (and no Clover-not-configured alert) when the provider is fully configured', async () => {
    providerState = {
      config: {
        paymentProvider: 'clover',
        merchantId: 'M_OK',
        publicTokenizerKey: 'pk_ok',
        environment: 'sandbox',
        providerConfigured: true,
        missingFields: [],
      },
      isLoading: false,
      isClover: true,
      isSquare: false,
      supportsWallets: false,
      isProviderConfigured: true,
      missingFields: [],
    };

    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('tab', { name: /credit card/i }));

    // The friendly Alert must NOT render when every required
    // credential is present — otherwise we'd be permanently
    // hiding the card UI from properly configured locations.
    expect(screen.queryByTestId('alert-clover-not-configured')).not.toBeInTheDocument();

    // The card section IS rendered now (its loading spinner copy
    // is the most stable signal that the section mounted in
    // jsdom — the actual card iframe is the SDK's responsibility).
    expect(
      await screen.findByText(/Loading credit card form/i),
    ).toBeInTheDocument();
  });
});
