/**
 * Component test for the deletion-requests page's "Copy JSON" /
 * "Download .json" export buttons (task #347).
 *
 * Locks in the compliance-export contract:
 *   1. Each Execution-details panel renders a Copy JSON and a
 *      Download .json button keyed off the request id.
 *   2. Copy writes the verbatim parsed executionSummary (NOT the
 *      raw stored string with its escape characters) to the
 *      clipboard, pretty-printed.
 *   3. Download generates a Blob link whose filename starts with
 *      `deletion-request-<id>-` and ends with `.json`, so SAR
 *      tickets always have a stable, sortable name.
 *
 * Backend interactions are stubbed via a fetch mock — the page
 * pulls the request list from /api/system-admin/deletion-requests
 * and renders the panel from the parsed `executionSummary` on
 * each row.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import DeletionRequestsPage from '@/pages/deletion-requests-page';
import type { DeletionExecutionSummary } from '@shared/schema';

vi.mock('@/components/layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// The page does not render <Toaster />, so a real `useToast` would
// queue items into a context the test never reads. Mock the hook
// to expose the calls directly to assertions. `vi.hoisted` is
// required because `vi.mock` factories run before module-level
// `const` declarations are evaluated.
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

const summary: DeletionExecutionSummary = {
  executedAt: '2026-04-22T15:34:56.789Z',
  executedBy: 7,
  email: 'gone@example.com',
  user: { deleted: true, userId: 42 },
  bowlers: [
    { bowlerId: 100, anonymized: true, hadPaymentCustomerId: true, hadCardpointeProfileId: false },
    {
      bowlerId: 101,
      anonymized: false,
      hadPaymentCustomerId: false,
      hadCardpointeProfileId: false,
      reason: 'locked by active session',
    },
  ],
  paymentProvider: [
    {
      locationId: 1,
      providerName: 'stripe',
      customerId: 'cus_abc',
      deleted: true,
    },
  ],
  emailChangeRequestsDeleted: 0,
};

const completedRow = {
  id: 999,
  email: 'gone@example.com',
  reason: 'gdpr',
  status: 'completed',
  adminNote: null,
  reviewedBy: 7,
  reviewedAt: '2026-04-22T15:34:56.789Z',
  ipAddress: null,
  userAgent: null,
  executionSummary: JSON.stringify(summary),
  createdAt: '2026-04-21T10:00:00.000Z',
};

const originalFetch = global.fetch;

beforeEach(() => {
  toastMock.mockClear();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/system-admin/deletion-requests')) {
      return new Response(JSON.stringify({ success: true, data: [completedRow] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Default the page to the "completed" tab so the seeded row
  // surfaces immediately — the page boots on "pending".
  return render(
    <QueryClientProvider client={qc}>
      <DeletionRequestsPage />
    </QueryClientProvider>,
  );
}

async function openExecutionDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: /completed/i }));
  // Wait for the row to land, then expand the execution panel.
  await waitFor(() =>
    expect(screen.getByTestId('deletion-request-row-999')).toBeInTheDocument(),
  );
  await user.click(screen.getByTestId('toggle-summary-999'));
  return await screen.findByTestId('execution-summary-panel');
}

describe('Deletion requests · execution-summary export (task #347)', () => {
  it('Copy JSON writes the parsed summary verbatim to the clipboard', async () => {
    // userEvent.setup() installs its own jsdom clipboard, so spy
    // on whatever it provides rather than overwriting the property
    // (which userEvent re-applies when the click handler fires).
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();

    renderPage();
    await openExecutionDetails(user);

    await user.click(screen.getByTestId('button-copy-summary-999'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const written = writeText.mock.calls[0]![0] as string;
    // Pretty-printed (two-space indent), so the second line begins
    // with two spaces. This is the contract for compliance pasting.
    expect(written.split('\n')[1]).toMatch(/^ {2}"/);
    // And the parsed payload must round-trip to exactly the same
    // object the panel rendered — no extra fields, no missing
    // fields, no double-escaping from the raw stored string.
    expect(JSON.parse(written)).toEqual(summary);

    // The admin must see explicit confirmation that the copy
    // worked — silent success leaves them wondering whether to
    // re-click and double-paste the JSON into a ticket.
    await waitFor(() => {
      const successCall = toastMock.mock.calls.find((c) =>
        /copied execution summary/i.test((c[0] as { title?: string }).title ?? ''),
      );
      expect(successCall).toBeDefined();
      expect((successCall![0] as { variant?: string }).variant).toBeUndefined();
    });
  });

  it('shows a destructive toast when navigator.clipboard is undefined (insecure context / older browser)', async () => {
    // Some dev servers run plain HTTP, where navigator.clipboard
    // is not exposed at all. The button must still tell the user
    // why nothing happened, otherwise the page would look broken.
    const user = userEvent.setup();
    // Wipe userEvent's clipboard polyfill for this test.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    renderPage();
    await openExecutionDetails(user);

    await user.click(screen.getByTestId('button-copy-summary-999'));

    await waitFor(() => {
      const failureCall = toastMock.mock.calls.find((c) =>
        /copy failed/i.test((c[0] as { title?: string }).title ?? ''),
      );
      expect(failureCall).toBeDefined();
      expect((failureCall![0] as { description?: string }).description).toMatch(
        /clipboard api unavailable/i,
      );
    });
  });

  it('shows a destructive toast when navigator.clipboard.writeText rejects', async () => {
    // Even with userEvent's clipboard installed, a real-world
    // failure (locked clipboard, denied permission, focus loss)
    // surfaces as a rejected promise. The handler must catch and
    // route it through a destructive toast instead of bubbling
    // out into an uncaught rejection.
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('Document is not focused'),
    );

    renderPage();
    await openExecutionDetails(user);

    await user.click(screen.getByTestId('button-copy-summary-999'));

    await waitFor(() => {
      const failureCall = toastMock.mock.calls.find((c) =>
        /copy failed/i.test((c[0] as { title?: string }).title ?? ''),
      );
      expect(failureCall).toBeDefined();
      expect((failureCall![0] as { variant?: string }).variant).toBe('destructive');
    });
  });

  it('Download .json triggers an anchor click with a request-keyed filename', async () => {
    // jsdom doesn't implement URL.createObjectURL — provide a stub
    // and capture the anchor created by the handler so we can
    // assert on the download attribute.
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = createObjectURL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = revokeObjectURL;

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        // capture the configured download attribute via `this`
      });

    const user = userEvent.setup();
    renderPage();
    const panel = await openExecutionDetails(user);

    await user.click(within(panel).getByTestId('button-download-summary-999'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // The anchor is the most recently-clicked HTMLAnchorElement.
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^deletion-request-999-/);
    expect(anchor.download).toMatch(/\.json$/);
    // ISO timestamp from the summary's executedAt
    // (2026-04-22T15:34:56.789Z) — colons + dot must be sanitized
    // in the stem because Windows file systems reject `:` and the
    // bare `.` would split the filename in some download UIs.
    const stem = anchor.download.replace(/\.json$/, '');
    expect(stem).not.toMatch(/[:.]/);
    expect(stem).toContain('2026-04-22T15-34-56-789Z');

    // Revocation is intentionally deferred to the next tick so
    // some browsers don't cancel the still-pending download — give
    // the timer a beat to fire before asserting.
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url'));
  });

  it('falls back to a current-time stamp when executedAt is missing on a malformed legacy row', async () => {
    // Legacy rows that survived parseExecutionSummary's normalizer
    // can carry an empty executedAt string. The download must
    // still produce a valid, sortable filename instead of crashing
    // or shipping a literal "undefined" in the filename.
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/system-admin/deletion-requests')) {
        const legacyRow = {
          ...completedRow,
          executionSummary: JSON.stringify({ ...summary, executedAt: '' }),
        };
        return new Response(JSON.stringify({ success: true, data: [legacyRow] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const createObjectURL = vi.fn(() => 'blob:legacy');
    const revokeObjectURL = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = createObjectURL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const user = userEvent.setup();
    renderPage();
    const panel = await openExecutionDetails(user);

    await user.click(within(panel).getByTestId('button-download-summary-999'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    // Still keyed off the request id, still ends in .json, and
    // the timestamp segment is a valid ISO-derived string (no
    // literal "undefined" / "null" / colon characters).
    expect(anchor.download).toMatch(/^deletion-request-999-/);
    expect(anchor.download).toMatch(/\.json$/);
    expect(anchor.download).not.toMatch(/undefined|null|NaN/);
    const stem = anchor.download.replace(/\.json$/, '');
    expect(stem).not.toMatch(/[:.]/);
  });
});
