import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Client-side half of the BowlNow "preserve on omit" contract
 * (task #486). Task #481 already pinned the SERVER half: the PATCH
 * /api/integrations route treats `undefined` keys in the `bowlnow`
 * payload as "preserve" and `""` as "clear", so the toggle path can
 * flip `enabled` on/off without wiping the previously-saved
 * `leagueNameFieldId` / `leagueSeasonFieldId` — but ONLY as long as
 * the client genuinely OMITS those keys from the request body, rather
 * than spreading the form state and accidentally sending them as
 * empty strings (which would clear them).
 *
 * `bowlnow-integration-card.tsx`'s `handleToggleEnabled` calls
 * `mutation.mutate({ enabled: false })` and `{ enabled: true }`
 * literally — no spread, no field-id keys. A future refactor that
 * "tidies up" the payload could silently re-introduce the wipe-on-
 * toggle bug, with no test in either layer to catch it.
 *
 * These tests render the card with non-empty seeded field IDs, fire
 * each toggle direction, and assert the outgoing PATCH body's
 * `bowlnow` object contains `enabled` and DOES NOT contain either
 * field-ID key at all (`'leagueNameFieldId' in bowlnow === false`).
 */

const toastFn = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastFn }),
}));

import { BowlNowCard, type BowlNowConfig } from '@/components/bowlnow-integration-card';
import { clearCsrfToken } from '@/lib/queryClient';

const ORG_ID = 7;

const SEEDED_CONFIG_ENABLED: BowlNowConfig = {
  enabled: true,
  apiKeyConfigured: true,
  locationId: 'loc_seed_123',
  leagueNameFieldId: 'cf_league_name_seed_abc',
  leagueSeasonFieldId: 'cf_league_season_seed_xyz',
};

const SEEDED_CONFIG_DISABLED: BowlNowConfig = {
  ...SEEDED_CONFIG_ENABLED,
  enabled: false,
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const originalFetch = global.fetch;
let lastPatchBody: { organizationId?: number; bowlnow?: Record<string, unknown> } | null = null;

function installFetchMock() {
  lastPatchBody = null;
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.includes('/api/csrf-token')) {
      return jsonRes({ success: true, data: { token: 'test-csrf' } });
    }

    if (url.endsWith('/api/integrations') && method === 'PATCH') {
      try {
        lastPatchBody = init?.body ? JSON.parse(init.body as string) : null;
      } catch {
        lastPatchBody = null;
      }
      return jsonRes({ success: true, data: { ok: true } });
    }

    return jsonRes({ success: false, error: { message: `unmocked: ${method} ${url}` } }, 500);
  }) as unknown as typeof fetch;
}

function renderCard(config: BowlNowConfig) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <BowlNowCard config={config} orgId={ORG_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  toastFn.mockReset();
  clearCsrfToken();
  installFetchMock();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('BowlNowCard — toggle preserves saved field IDs (task #486)', () => {
  it('toggling OFF sends only { enabled: false } and OMITS both field-ID keys', async () => {
    const user = userEvent.setup();
    renderCard(SEEDED_CONFIG_ENABLED);

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();

    await user.click(toggle);

    await waitFor(() => {
      expect(lastPatchBody).not.toBeNull();
    });

    expect(lastPatchBody?.organizationId).toBe(ORG_ID);
    const bowlnow = lastPatchBody?.bowlnow ?? {};
    expect(bowlnow.enabled).toBe(false);

    // The whole point of #486: the toggle path must not include the
    // field-ID keys AT ALL (not even as empty strings), or the
    // server-side merge will read `""` as "clear" and wipe the
    // previously-saved IDs. Use `in` so we'd fail loudly even if a
    // refactor sent `leagueNameFieldId: ""` or `: undefined`.
    expect('leagueNameFieldId' in bowlnow).toBe(false);
    expect('leagueSeasonFieldId' in bowlnow).toBe(false);

    // Sanity: also no apiKey / locationId leakage from form state.
    expect('apiKey' in bowlnow).toBe(false);
    expect('locationId' in bowlnow).toBe(false);
  });

  it('toggling ON (with apiKeyConfigured) sends only { enabled: true } and OMITS both field-ID keys', async () => {
    const user = userEvent.setup();
    renderCard(SEEDED_CONFIG_DISABLED);

    const toggle = screen.getByRole('switch');
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    await waitFor(() => {
      expect(lastPatchBody).not.toBeNull();
    });

    expect(lastPatchBody?.organizationId).toBe(ORG_ID);
    const bowlnow = lastPatchBody?.bowlnow ?? {};
    expect(bowlnow.enabled).toBe(true);

    expect('leagueNameFieldId' in bowlnow).toBe(false);
    expect('leagueSeasonFieldId' in bowlnow).toBe(false);
    expect('apiKey' in bowlnow).toBe(false);
    expect('locationId' in bowlnow).toBe(false);
  });
});
