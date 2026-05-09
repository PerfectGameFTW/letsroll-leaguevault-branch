/**
 * Task #702: BowlerSearchPicker — debounced search calls the backend,
 * shows results, and forwards the selected bowler to onSelect.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { BowlerSearchPicker } from '@/components/bowler-search-picker';

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPicker(props: Parameters<typeof BowlerSearchPicker>[0]) {
  const qc = makeClient();
  return render(
    <QueryClientProvider client={qc}>
      <BowlerSearchPicker {...props} />
    </QueryClientProvider>,
  );
}

const csrfResponse = () =>
  new Response(JSON.stringify({ success: true, data: { token: 't' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  fetchMock.mockReset();
});

describe('BowlerSearchPicker', () => {
  it('debounces input, hits /api/bowlers/search, and calls onSelect on click', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/csrf-token')) return csrfResponse();
      if (url.includes('/api/bowlers/search')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              { id: 11, name: 'Aviv Adler', organizationId: 5, secondaryLabel: 'Tuesday Mixed' },
              { id: 12, name: 'Avi Cohen', organizationId: 5, secondaryLabel: 'a***@example.com' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not-found', { status: 404 });
    });

    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPicker({ onSelect, excludeIds: [42], testIdPrefix: 'pick' });

    await user.type(screen.getByTestId('pick-input'), 'av');

    await waitFor(
      () => {
        expect(screen.getByTestId('pick-result-11')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(screen.getByTestId('pick-result-12')).toBeInTheDocument();

    const searchCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/api/bowlers/search'),
    );
    expect(searchCall).toBeTruthy();
    const searchUrl = String(searchCall?.[0] ?? '');
    expect(searchUrl).toContain('excludeIds=42');
    expect(searchUrl).toContain('q=av');

    await user.click(screen.getByTestId('pick-result-11'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11, name: 'Aviv Adler' }),
    );
  });

  it('supports keyboard navigation: ArrowDown + Enter selects, Escape closes', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/csrf-token')) return csrfResponse();
      if (url.includes('/api/bowlers/search')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              { id: 1, name: 'Alice', organizationId: 5, secondaryLabel: null },
              { id: 2, name: 'Avery', organizationId: 5, secondaryLabel: null },
              { id: 3, name: 'Avi', organizationId: 5, secondaryLabel: null },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not-found', { status: 404 });
    });

    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPicker({ onSelect, testIdPrefix: 'kb' });

    const input = screen.getByTestId('kb-input');
    await user.type(input, 'av');

    await waitFor(
      () => expect(screen.getByTestId('kb-result-1')).toBeInTheDocument(),
      { timeout: 3000 },
    );

    // Arrow down twice → highlight Avi (index 2), Enter selects.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3, name: 'Avi' }),
    );

    // Type again, then Escape — panel should close.
    await user.type(input, 'av');
    await waitFor(
      () => expect(screen.getByTestId('kb-result-1')).toBeInTheDocument(),
      { timeout: 3000 },
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('kb-panel')).not.toBeInTheDocument();
  });

  it('does not call the backend until at least 2 chars are typed', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/csrf-token')) return csrfResponse();
      return new Response(
        JSON.stringify({ success: true, data: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const user = userEvent.setup();
    renderPicker({ onSelect: vi.fn(), testIdPrefix: 'pick' });

    await user.type(screen.getByTestId('pick-input'), 'a');
    // Wait well past the 250ms debounce.
    await new Promise((r) => setTimeout(r, 600));

    const searchCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/bowlers/search'),
    );
    expect(searchCalls).toHaveLength(0);
  });
});
