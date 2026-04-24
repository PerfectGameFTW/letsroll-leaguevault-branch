/**
 * Component test for the set-password / accept-invite page's
 * throttle UX (task #418).
 *
 * Locks in three behaviors that mirror the forgot-password and
 * change-password throttle banners:
 *   1. A 429 from POST /api/auth/set-password renders the
 *      destructive "too many attempts" alert, with the right
 *      countdown text driven by the Retry-After header.
 *   2. The submit button is disabled while throttled and reads
 *      "Try again in N minute(s)".
 *   3. The alert disappears once the cooldown elapses and the
 *      submit button becomes interactive again.
 *
 * The page uses raw `fetch`, so we mock the global fetch with a
 * route table — /api/auth/validate-invite resolves the invitation
 * synchronously so the form mounts, and /api/auth/set-password is
 * choreographed per-test.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import SetPasswordPage from '@/pages/set-password-page';

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

const originalFetch = global.fetch;
const originalLocationHref = window.location.href;
let setPasswordHandler: FetchHandler;

function installFetchMock() {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/auth/validate-invite')) {
      return new Response(
        JSON.stringify({
          success: true,
          data: { name: 'Pat Bowler', email: 'pat@example.com' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/api/auth/set-password')) {
      return setPasswordHandler(input, init);
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

// The page reads `?token=...` from the URL. Use wouter's memory
// router with a hook factory that always reports a search string
// containing a fake token, so the page's effect can extract it.
const { hook: memoryHook } = memoryLocation({ path: '/set-password' });
function useTestSearch(): string {
  return 'token=valid-test-token';
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={memoryHook} searchHook={useTestSearch}>
        <SetPasswordPage />
      </Router>
    </QueryClientProvider>,
  );
}

const STRONG_PASSWORD = 'StrongPw1!2026';

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  // Wait for the post-validate render — the form only mounts after
  // /api/auth/validate-invite resolves.
  const pwInput = await screen.findByLabelText(/^Password$/i);
  const confirmInput = await screen.findByLabelText(/confirm password/i);
  await user.type(pwInput, STRONG_PASSWORD);
  await user.type(confirmInput, STRONG_PASSWORD);
  await user.click(screen.getByTestId('button-set-password-submit'));
}

function rateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: { message: 'Too many requests' } }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'retry-after': String(retryAfterSeconds),
    },
  });
}

beforeEach(() => {
  installFetchMock();
  setPasswordHandler = () =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  // Stub navigation: the success path does
  // `window.location.href = '/'` which jsdom can't actually follow.
  // Re-defining the property keeps assignment a no-op so the test
  // doesn't unload the document mid-assertion.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: originalLocationHref },
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('SetPasswordPage throttle UX (task #418)', () => {
  it('renders the throttle alert on a 429 with the right countdown text', async () => {
    setPasswordHandler = () => rateLimitResponse(120);
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    const alert = await screen.findByTestId('alert-set-password-throttled');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/too many attempts/i);
    // The banner must reassure the user that the link itself is
    // still valid — without this, recipients hit 429 then go ask
    // for a brand-new email, invalidating their existing token.
    expect(alert).toHaveTextContent(/still valid/i);
    // 120s rounds up to "2 minutes" via formatCountdown.
    expect(screen.getByTestId('text-set-password-retry-in')).toHaveTextContent(/2 minutes/);
  });

  it('disables the submit button while throttled and shows a countdown label', async () => {
    setPasswordHandler = () => rateLimitResponse(60);
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    await screen.findByTestId('alert-set-password-throttled');
    const submit = screen.getByTestId('button-set-password-submit');
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent(/try again in 1 minute/i);
  });

  it('clears the throttle alert once the cooldown elapses', async () => {
    setPasswordHandler = () => rateLimitResponse(1);
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    await waitFor(() =>
      expect(screen.getByTestId('alert-set-password-throttled')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('button-set-password-submit')).toBeDisabled();

    await waitFor(
      () =>
        expect(screen.queryByTestId('alert-set-password-throttled')).not.toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(screen.getByTestId('button-set-password-submit')).not.toBeDisabled();
  });

  it('does NOT show the throttle alert on a normal success response', async () => {
    // Regression guard: the success path falls through to `await
    // response.json()` — make sure that path doesn't accidentally
    // also fire `throttle()`. Without this, a future refactor that
    // moved the 429 check below the json parse could silently
    // throttle every successful submit.
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    // Give the success handler a tick to settle.
    await waitFor(() =>
      expect(screen.queryByTestId('alert-set-password-throttled')).not.toBeInTheDocument(),
    );
  });

  it('handles a 429 with no JSON body without crashing (the 429 branch must run BEFORE response.json())', async () => {
    // Regression guard. Some upstream proxies return a 429 with an
    // empty body or a `text/plain` body. If the route handler
    // awaited `response.json()` before checking the status, that
    // call would throw with a SyntaxError and the user would see
    // the catch-all "Something went wrong" toast instead of the
    // throttle banner.
    setPasswordHandler = () =>
      new Response('', {
        status: 429,
        headers: { 'retry-after': '90' },
      });
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    const alert = await screen.findByTestId('alert-set-password-throttled');
    expect(alert).toBeInTheDocument();
    // 90s rounds up to "2 minutes" via formatCountdown (ceil division).
    expect(screen.getByTestId('text-set-password-retry-in')).toHaveTextContent(/2 minutes/);
  });

  it('falls back to the default cooldown when a 429 ships no Retry-After / RateLimit-Reset headers', async () => {
    // Upstream load balancers occasionally swallow the
    // Retry-After header on 429s. The page must still paint a
    // throttle banner — the default fallback (300 seconds → "5
    // minutes") keeps the user from spamming submits during the
    // server-side window. Pinning this prevents a future refactor
    // from accidentally treating "no header" as "no throttle".
    setPasswordHandler = () =>
      new Response(JSON.stringify({ error: { message: 'Too many requests' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    const alert = await screen.findByTestId('alert-set-password-throttled');
    expect(alert).toBeInTheDocument();
    expect(screen.getByTestId('text-set-password-retry-in')).toHaveTextContent(/5 minutes/);
    expect(screen.getByTestId('button-set-password-submit')).toBeDisabled();
  });

  it('does NOT show the throttle alert on a generic 400 validation error (no Retry-After)', async () => {
    setPasswordHandler = () =>
      new Response(
        JSON.stringify({ success: false, error: { message: 'Password too weak' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    const user = userEvent.setup();
    renderPage();

    await fillAndSubmit(user);

    await waitFor(() =>
      expect(screen.queryByTestId('alert-set-password-throttled')).not.toBeInTheDocument(),
    );
    // Submit should be re-enabled so the user can retry with a
    // different password.
    expect(screen.getByTestId('button-set-password-submit')).not.toBeDisabled();
  });
});
