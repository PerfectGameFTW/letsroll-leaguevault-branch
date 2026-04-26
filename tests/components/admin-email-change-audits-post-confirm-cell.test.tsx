/**
 * Render contract for the post-confirm payment-sync column on the
 * admin email-change history page (task #487).
 *
 * The column is the *only* surface that re-shows the deferred sync
 * result back to the admin who initiated the change, so two render
 * states matter most:
 *
 *   - `pending_retry`: must render a high-visibility destructive
 *     badge with the literal text "Needs manual retry" so an admin
 *     scanning the table cannot miss it.
 *   - `null` (target user hasn't clicked the link yet): must render
 *     a quiet "Awaiting confirmation" stub — distinguishable from
 *     "synced" so the admin doesn't mistake a still-pending row for
 *     a clean one.
 *
 * The other terminal statuses (`synced`, `skipped`, `not_applicable`)
 * are rendered subtly so the actionable `pending_retry` rows visually
 * pop, but we still want the *label* to be present (not a checkmark)
 * for triage clarity. We assert the label appears for `synced` to
 * lock in that intent.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/components/layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AdminEmailChangeAuditsPage from '@/pages/admin-email-change-audits-page';

const ROW_PENDING_RETRY = {
  id: 9001,
  actorUserId: 1,
  targetUserId: 100,
  oldEmailMasked: 'a***@example.com',
  newEmailMasked: 'b***@example.com',
  emailChangeRequestId: 555,
  postConfirmPaymentSyncStatus: 'pending_retry',
  postConfirmedAt: '2026-04-25T12:34:56.000Z',
  createdAt: '2026-04-24T10:00:00.000Z',
  actorName: 'Admin Person',
  targetName: 'Target Person',
};

const ROW_AWAITING = {
  id: 9002,
  actorUserId: 1,
  targetUserId: 101,
  oldEmailMasked: 'c***@example.com',
  newEmailMasked: 'd***@example.com',
  emailChangeRequestId: 556,
  postConfirmPaymentSyncStatus: null,
  postConfirmedAt: null,
  createdAt: '2026-04-24T11:00:00.000Z',
  actorName: 'Admin Person',
  targetName: 'Other Target',
};

const ROW_SYNCED = {
  id: 9003,
  actorUserId: 1,
  targetUserId: 102,
  oldEmailMasked: 'e***@example.com',
  newEmailMasked: 'f***@example.com',
  emailChangeRequestId: 557,
  postConfirmPaymentSyncStatus: 'synced',
  postConfirmedAt: '2026-04-25T09:00:00.000Z',
  createdAt: '2026-04-24T12:00:00.000Z',
  actorName: 'Admin Person',
  targetName: 'Third Target',
};

const originalFetch = global.fetch;

function mockAuditsResponse(rows: unknown[]) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/system-admin/admin-email-change-audits')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: { rows, total: rows.length, limit: 50, offset: 0 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('not mocked', { status: 404 });
  }) as typeof global.fetch;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AdminEmailChangeAuditsPage />
    </QueryClientProvider>,
  );
}

describe('AdminEmailChangeAuditsPage post-confirm sync cell (task #487)', () => {
  beforeEach(() => {
    // Reset any mocks left from a previous test.
    global.fetch = originalFetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders a high-visibility "Needs manual retry" badge for pending_retry', async () => {
    mockAuditsResponse([ROW_PENDING_RETRY]);
    renderPage();

    const row = await screen.findByTestId(`row-audit-${ROW_PENDING_RETRY.id}`);
    const cell = within(row).getByTestId('post-confirm-pending-retry');
    // The literal phrase the admin scans for. Locked in so a future
    // copy change (e.g. "Retry needed") can't slip through unnoticed —
    // operations playbooks reference this exact string.
    expect(within(cell).getByText('Needs manual retry')).toBeInTheDocument();
    // Confirmed-at sub-line is shown so the admin knows when the
    // failure happened and can correlate with provider dashboards.
    expect(within(cell).getByText(/Confirmed/)).toBeInTheDocument();
  });

  it('renders a quiet "Awaiting confirmation" stub when the target has not confirmed yet', async () => {
    mockAuditsResponse([ROW_AWAITING]);
    renderPage();

    const row = await screen.findByTestId(`row-audit-${ROW_AWAITING.id}`);
    expect(within(row).getByTestId('post-confirm-pending')).toHaveTextContent(
      'Awaiting confirmation',
    );
    // Critical separation: a not-yet-confirmed row must NOT render the
    // destructive "Needs manual retry" badge — that would mislead the
    // admin into thinking the sync failed when in fact the user just
    // hasn't clicked the link yet.
    expect(within(row).queryByText('Needs manual retry')).not.toBeInTheDocument();
  });

  it('renders the synced state subtly (no destructive badge) for a clean confirm', async () => {
    mockAuditsResponse([ROW_SYNCED]);
    renderPage();

    const row = await screen.findByTestId(`row-audit-${ROW_SYNCED.id}`);
    expect(within(row).getByTestId('post-confirm-synced')).toHaveTextContent('Synced');
    // The destructive badge is reserved for the actionable case;
    // synced rows must not borrow its visual weight or the admin's
    // eye stops trusting the badge as a signal.
    expect(within(row).queryByText('Needs manual retry')).not.toBeInTheDocument();
  });

  it('shows all three states correctly when the table mixes them', async () => {
    mockAuditsResponse([ROW_PENDING_RETRY, ROW_AWAITING, ROW_SYNCED]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId(`row-audit-${ROW_PENDING_RETRY.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`row-audit-${ROW_AWAITING.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`row-audit-${ROW_SYNCED.id}`)).toBeInTheDocument();
    });
    // Exactly one destructive badge across the three rendered rows —
    // proves the badge styling isn't accidentally bleeding into the
    // other states.
    expect(screen.getAllByText('Needs manual retry')).toHaveLength(1);
    expect(screen.getAllByText('Awaiting confirmation')).toHaveLength(1);
    expect(screen.getAllByText('Synced')).toHaveLength(1);
  });
});
