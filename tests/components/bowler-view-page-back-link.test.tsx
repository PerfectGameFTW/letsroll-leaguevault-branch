/**
 * Component test for the context-aware "back" link on the bowler view
 * page (`/bowlers/:bowlerId`).
 *
 * Background: the bowler detail page used to always render a single
 * "← Back to Team" link as long as the selected league association had
 * a teamId. That link was wrong when the user reached the bowler from
 * the Bowlers tab — clicking it took them to a team page they had not
 * been on. The Bowlers list now appends `?from=bowlers` to the link;
 * the bowler view reads the param and renders "← Back to Bowlers"
 * instead, pointing at `/bowlers`.
 *
 * This test pins both cases:
 *   1. With `?from=bowlers` the page renders the back-to-bowlers link
 *      (and not the back-to-team link), and the href points at the
 *      bowlers list.
 *   2. Without the query param the existing back-to-team behavior is
 *      preserved when the bowler is on a team for the selected league.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiResponse, BowlerDetailsResponse } from '@shared/schema';

if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = NoopResizeObserver;
}

vi.mock('@/components/layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/bowler-financial-summary', () => ({
  BowlerFinancialSummary: () => <div data-testid="stub-financial-summary" />,
}));

vi.mock('@/components/bowler-payment-history-table', () => ({
  BowlerPaymentHistoryTable: () => <div data-testid="stub-payment-history" />,
}));

vi.mock('@/components/payment-sync-retry-status', () => ({
  PaymentSyncRetryStatus: () => <div data-testid="stub-retry-status" />,
}));

let currentSearch = '';
let currentPath = '/bowlers/55';
vi.mock('wouter', async () => {
  const actual = await vi.importActual<typeof import('wouter')>('wouter');
  return {
    ...actual,
    useSearch: () => currentSearch,
    useParams: () => ({ bowlerId: '55' }),
    useLocation: () => [currentPath, () => {}],
  };
});

import BowlerViewPage from '@/pages/bowler-view-page';

const BOWLER_ID = 55;
const LEAGUE_ID = 700;
const TEAM_ID = 8001;

const DETAILS: BowlerDetailsResponse = {
  bowler: {
    id: BOWLER_ID,
    name: 'Jane Doe',
    email: 'jane@example.com',
    active: true,
    organizationId: 1,
    bnContactId: null,
    hasAccount: false,
    paymentSyncStatus: null,
    paymentSyncRetryAt: null,
    paymentSyncLastError: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  bowlerLeagues: [
    {
      id: 9001,
      bowlerId: BOWLER_ID,
      leagueId: LEAGUE_ID,
      teamId: TEAM_ID,
      active: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  ],
  leagues: [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { id: LEAGUE_ID, name: 'Tuesday Night Mixed', active: true } as any,
  ],
  teams: [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { id: TEAM_ID, name: 'Pin Crushers', leagueId: LEAGUE_ID } as any,
  ],
};

function renderPage(search: string) {
  currentSearch = search;
  currentPath = `/bowlers/${BOWLER_ID}${search ? `?${search}` : ''}`;

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  qc.setQueryData<ApiResponse<BowlerDetailsResponse>>(
    [`/api/bowlers/${BOWLER_ID}/details`],
    { success: true, data: DETAILS },
  );
  qc.setQueryData([`/api/bn/status`], { success: true, data: { configured: false } });

  return render(
    <QueryClientProvider client={qc}>
      <BowlerViewPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  currentSearch = '';
  currentPath = `/bowlers/${BOWLER_ID}`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BowlerViewPage back link', () => {
  it('renders "Back to Bowlers" pointing at /bowlers when ?from=bowlers is set', async () => {
    renderPage('from=bowlers');

    const backLink = await screen.findByTestId('link-back-to-bowlers');
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute('href', '/bowlers');
    expect(backLink).toHaveTextContent(/back to bowlers/i);

    expect(screen.queryByTestId('link-back-to-team')).not.toBeInTheDocument();
  });

  it('renders "Back to Team" pointing at the team page when no from query is present', async () => {
    renderPage('');

    const backLink = await screen.findByTestId('link-back-to-team');
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute('href', `/teams/${TEAM_ID}`);
    expect(backLink).toHaveTextContent(/back to team/i);

    expect(screen.queryByTestId('link-back-to-bowlers')).not.toBeInTheDocument();
  });

  it('ignores unrelated query params and falls back to the team link', async () => {
    renderPage('foo=bar&from=somewhere-else');

    const backLink = await screen.findByTestId('link-back-to-team');
    expect(backLink).toHaveAttribute('href', `/teams/${TEAM_ID}`);

    expect(screen.queryByTestId('link-back-to-bowlers')).not.toBeInTheDocument();
  });
});
