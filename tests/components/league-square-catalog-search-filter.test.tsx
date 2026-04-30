import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
}

const MONDAY_COUNT = 10;
const TUESDAY_COUNT = 10;
const TOTAL_ITEMS = MONDAY_COUNT + TUESDAY_COUNT;

const ITEMS = Array.from({ length: TOTAL_ITEMS }, (_, i) => {
  const isMonday = i < MONDAY_COUNT;
  const dayName = isMonday ? 'Monday' : 'Tuesday';
  const dayIndex = (isMonday ? i : i - MONDAY_COUNT) + 1;
  return {
    id: `item-${i + 1}`,
    name: `${dayName} League Item ${dayIndex}`,
    description: '',
    variations: [
      { id: `var-${i + 1}`, name: 'Regular', price: 1500, currency: 'USD' },
    ],
  };
});

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/api/payments-provider/catalog/categories')) {
    return new Response(
      JSON.stringify({ success: true, data: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (url.includes('/api/payments-provider/catalog/items')) {
    return new Response(
      JSON.stringify({ success: true, data: ITEMS }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response('not-found', { status: 404 });
});
vi.stubGlobal('fetch', fetchMock);

import type { InsertLeague } from '@shared/schema';
import { Form } from '@/components/ui/form';
import { LeagueSquareCatalog } from '@/components/league-square-catalog';

interface HarnessProps {
  savedLineageVariationId?: string | null;
  savedLineageItemName?: string | null;
  savedPrizeFundVariationId?: string | null;
  savedPrizeFundItemName?: string | null;
}

function Harness({
  savedLineageVariationId = null,
  savedLineageItemName = null,
  savedPrizeFundVariationId = null,
  savedPrizeFundItemName = null,
}: HarnessProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const form = useForm<InsertLeague>({
    defaultValues: {
      name: '',
      description: '',
      active: true,
      allowPublicSignup: false,
      seasonStart: new Date().toISOString(),
      seasonEnd: new Date().toISOString(),
      weekDay: 'Monday',
      practiceStartTime: '',
      competitionStartTime: '',
      timezone: 'America/New_York',
      weeklyFee: 0,
      lineageFee: null,
      prizeFundFee: null,
      finalTwoWeeksDueWeek: 6,
      paymentMode: 'weekly',
      squareLineageItemId: null,
      lineageItemVariationId: savedLineageVariationId,
      squareLineageItemName: savedLineageItemName,
      squarePrizeFundItemId: null,
      prizeFundItemVariationId: savedPrizeFundVariationId,
      squarePrizeFundItemName: savedPrizeFundItemName,
      squareCategoryId: null,
      locationId: null,
      totalBowlingWeeks: 30,
      skipDates: [],
      cancelledDates: [],
    },
  });
  return (
    <Form {...form}>
      <LeagueSquareCatalog
        form={form}
        locationId={1}
        selectedCategoryId={selectedCategoryId}
        onCategoryChange={setSelectedCategoryId}
      />
    </Form>
  );
}

function renderHarness(props: HarnessProps = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

// The 3 Radix combobox triggers, in render order, are:
//   0 = "Filter by Category", 1 = "Lineage Item", 2 = "Prize Fund Item"
const LINEAGE_TRIGGER_INDEX = 1;
const PRIZE_FUND_TRIGGER_INDEX = 2;

async function openSelect(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
) {
  const triggers = screen.getAllByRole('combobox');
  await user.click(triggers[index]);
  // Wait for the listbox / its options to appear in the portal.
  await waitFor(() => {
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });
}

async function closeOpenSelect(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
}

describe('LeagueSquareCatalog search filter', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  it('typing in the search narrows both Lineage and Prize Fund dropdowns and clearing restores them', async () => {
    const user = userEvent.setup();
    renderHarness();

    const input = await screen.findByTestId<HTMLInputElement>(
      'input-catalog-search',
    );
    await waitFor(() => expect(input).not.toBeDisabled());

    // Baseline: Lineage dropdown shows all 20 items + the "None" sentinel = 21 options.
    await openSelect(user, LINEAGE_TRIGGER_INDEX);
    expect(screen.getAllByRole('option')).toHaveLength(TOTAL_ITEMS + 1);
    await closeOpenSelect(user);

    // Baseline: Prize Fund dropdown shows the same 21 options.
    await openSelect(user, PRIZE_FUND_TRIGGER_INDEX);
    expect(screen.getAllByRole('option')).toHaveLength(TOTAL_ITEMS + 1);
    await closeOpenSelect(user);

    // Type a query that should match only the 10 "Tuesday" items, then wait
    // for the debounce (~200ms) to flush via the visible match-count line.
    await user.type(input, 'tuesday');
    await waitFor(() => {
      const counter = screen.getByTestId('text-catalog-search-count');
      expect(counter.textContent).toContain(
        `${TUESDAY_COUNT} of ${TOTAL_ITEMS}`,
      );
    });

    // Lineage dropdown is now narrowed to the 10 tuesday items + "None" = 11.
    await openSelect(user, LINEAGE_TRIGGER_INDEX);
    let options = screen.getAllByRole('option');
    expect(options).toHaveLength(TUESDAY_COUNT + 1);
    for (const opt of options) {
      const label = opt.textContent ?? '';
      expect(label === 'None' || label.startsWith('Tuesday League Item')).toBe(
        true,
      );
    }
    await closeOpenSelect(user);

    // Prize Fund dropdown is narrowed identically.
    await openSelect(user, PRIZE_FUND_TRIGGER_INDEX);
    options = screen.getAllByRole('option');
    expect(options).toHaveLength(TUESDAY_COUNT + 1);
    for (const opt of options) {
      const label = opt.textContent ?? '';
      expect(label === 'None' || label.startsWith('Tuesday League Item')).toBe(
        true,
      );
    }
    await closeOpenSelect(user);

    // Clear the search via the inline X button. The match-count line disappears
    // and both dropdowns return to the full 21-option list.
    await user.click(screen.getByTestId('button-clear-catalog-search'));
    expect(input.value).toBe('');
    await waitFor(() => {
      expect(
        screen.queryByTestId('text-catalog-search-count'),
      ).not.toBeInTheDocument();
    });

    await openSelect(user, LINEAGE_TRIGGER_INDEX);
    expect(screen.getAllByRole('option')).toHaveLength(TOTAL_ITEMS + 1);
    await closeOpenSelect(user);

    await openSelect(user, PRIZE_FUND_TRIGGER_INDEX);
    expect(screen.getAllByRole('option')).toHaveLength(TOTAL_ITEMS + 1);
    await closeOpenSelect(user);
  });

  it('a previously-saved selection still appears via the fallback row when the search would hide it', async () => {
    const user = userEvent.setup();
    // Pre-seed both dropdowns with saved Monday selections that the
    // upcoming "tuesday" search will filter out of the visible list.
    renderHarness({
      savedLineageVariationId: 'var-1',
      savedLineageItemName: 'Monday League Item 1',
      savedPrizeFundVariationId: 'var-2',
      savedPrizeFundItemName: 'Monday League Item 2',
    });

    const input = await screen.findByTestId<HTMLInputElement>(
      'input-catalog-search',
    );
    await waitFor(() => expect(input).not.toBeDisabled());

    await user.type(input, 'tuesday');
    await waitFor(() => {
      const counter = screen.getByTestId('text-catalog-search-count');
      expect(counter.textContent).toContain(
        `${TUESDAY_COUNT} of ${TOTAL_ITEMS}`,
      );
    });

    // Lineage: "None" + fallback (Monday League Item 1) + 10 visible Tuesdays = 12.
    await openSelect(user, LINEAGE_TRIGGER_INDEX);
    let options = screen.getAllByRole('option');
    expect(options).toHaveLength(TUESDAY_COUNT + 2);
    expect(
      options.some((opt) => opt.textContent === 'Monday League Item 1'),
    ).toBe(true);
    await closeOpenSelect(user);

    // Prize Fund: same shape but with its own saved fallback row.
    await openSelect(user, PRIZE_FUND_TRIGGER_INDEX);
    options = screen.getAllByRole('option');
    expect(options).toHaveLength(TUESDAY_COUNT + 2);
    expect(
      options.some((opt) => opt.textContent === 'Monday League Item 2'),
    ).toBe(true);
    await closeOpenSelect(user);
  });
});
