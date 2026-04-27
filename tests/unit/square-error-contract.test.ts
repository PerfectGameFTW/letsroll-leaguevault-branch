/**
 * Regression pin for tasks #511 and #514.
 *
 * `client/src/lib/square.ts` was rewritten twice to stop throwing
 * `Error(JSON.stringify(...))` from `createPayment` and
 * `createSquareCustomer`. Without these specs, a well-meaning refactor
 * could re-introduce the JSON-stringified message and the user-visible
 * toast would silently regress to `{"error":{"message":...}}`.
 *
 * Each entry point is tested for the same four shapes of provider
 * response so the public contract — `.message` is a clean human
 * sentence, `.code` is structured, `.status` is the HTTP status — is
 * locked in:
 *   (a) successful response                       → resolves
 *   (b) structured `{ error: { message, code } }` → all three fields populated
 *   (c) plain-text body (HTML, gateway error)    → `.message` falls back to text, never JSON
 *   (d) `PROVIDER_NOT_CONFIGURED`                 → code/status/message survive the outer catch
 *
 * `csrfFetch` is mocked so these tests never touch the backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { csrfFetchMock } = vi.hoisted(() => ({
  csrfFetchMock: vi.fn(),
}));

vi.mock('@/lib/queryClient', () => ({
  csrfFetch: csrfFetchMock,
}));

import { createPayment, createSquareCustomer } from '@/lib/square';
import { PROVIDER_NOT_CONFIGURED } from '@/lib/provider-not-configured';
import type { SquareCard } from '@/hooks/use-square-payment';

interface FakeResponseInit {
  ok: boolean;
  status: number;
  jsonBody?: unknown;
  textBody?: string;
}

/**
 * Mimic just enough of `Response` for `square.ts`: it calls
 * `.clone().json()` first and, if that throws, falls back to
 * `.text()`. The fake's `clone()` returns the same object so
 * subsequent reads on the original (or its clone) keep working.
 */
function fakeResponse({ ok, status, jsonBody, textBody }: FakeResponseInit) {
  const resp: {
    ok: boolean;
    status: number;
    clone: () => typeof resp;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
  } = {
    ok,
    status,
    clone() {
      return resp;
    },
    async json() {
      if (jsonBody === undefined) {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      }
      return jsonBody;
    },
    async text() {
      if (textBody !== undefined) return textBody;
      if (jsonBody !== undefined) return JSON.stringify(jsonBody);
      return '';
    },
  };
  return resp;
}

// Hold a separately-typed handle to the mock so the beforeEach reset
// doesn't need to re-cast `okTokenizeCard`. Stub the full `SquareCard`
// surface (one of the two members of `createPayment`'s second-arg
// union) so no `as unknown as Foo` double-cast is needed — the unused
// `destroy`/`attach` stubs are required only to satisfy the interface.
const okTokenize = vi.fn().mockResolvedValue({ status: 'OK', token: 'tok_abc123' });
const okTokenizeCard: SquareCard = {
  tokenize: okTokenize,
  destroy: vi.fn(),
  attach: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  csrfFetchMock.mockReset();
  // The card is reused across tests; reset its tokenize stub each time
  // so call counts and resolved values can't leak between specs.
  okTokenize.mockReset().mockResolvedValue({ status: 'OK', token: 'tok_abc123' });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createPayment error contract (tasks #511 / #514)', () => {
  it('(a) resolves with the payment result on a successful response', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: true,
        status: 200,
        jsonBody: {
          id: 'pmt_123',
          status: 'COMPLETED',
          card: { last4: '1111', brand: 'VISA' },
        },
      }),
    );

    const result = await createPayment(2500, okTokenizeCard, 1, 2);

    expect(result.id).toBe('pmt_123');
    expect(result.status).toBe('COMPLETED');
  });

  it('(b) populates .message, .code, and .status from a structured error body', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 402,
        jsonBody: {
          error: { message: 'Card was declined.', code: 'CARD_DECLINED' },
        },
      }),
    );

    const err = await createPayment(2500, okTokenizeCard, 1, 2)
      .then(
        () => {
          throw new Error('helper unexpectedly resolved instead of rejecting');
        },
        (e: unknown) => e as Error & { code?: string; status?: number },
      );

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Card was declined.');
    expect(err.code).toBe('CARD_DECLINED');
    expect(err.status).toBe(402);
    // The whole point of this regression test: no JSON-shaped soup
    // ever appears in the user-visible message.
    expect(err.message).not.toMatch(/[{}]/);
    expect(err.message).not.toMatch(/"error"/);
  });

  it('(c) falls back to plain-text body for non-JSON responses without leaking JSON', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 502,
        textBody: 'Bad Gateway',
      }),
    );

    const err = await createPayment(2500, okTokenizeCard, 1, 2)
      .then(
        () => {
          throw new Error('helper unexpectedly resolved instead of rejecting');
        },
        (e: unknown) => e as Error & { code?: string; status?: number },
      );

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Bad Gateway');
    // No structured code on the wire → the helper still attaches the
    // `PAYMENT_FAILED` fallback so callers can branch on `.code`.
    expect(err.code).toBe('PAYMENT_FAILED');
    expect(err.status).toBe(502);
    expect(err.message).not.toMatch(/[{}]/);
  });

  it('(d) preserves PROVIDER_NOT_CONFIGURED end-to-end through the outer catch', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 422,
        jsonBody: {
          error: {
            message: "Square isn't connected for this location.",
            code: PROVIDER_NOT_CONFIGURED,
          },
        },
      }),
    );

    const err = await createPayment(2500, okTokenizeCard, 1, 2)
      .then(
        () => {
          throw new Error('helper unexpectedly resolved instead of rejecting');
        },
        (e: unknown) => e as Error & { code?: string; status?: number },
      );

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(PROVIDER_NOT_CONFIGURED);
    expect(err.status).toBe(422);
    expect(err.message).toBe("Square isn't connected for this location.");
    // Crucially: the outer catch must NOT have downgraded `.code` to
    // `PAYMENT_FAILED` nor stuffed a JSON blob into `.message`.
    expect(err.code).not.toBe('PAYMENT_FAILED');
    expect(err.message).not.toMatch(/[{}]/);
  });
});

describe('createSquareCustomer error contract (tasks #511 / #514)', () => {
  it('(a) resolves with the customer on a successful response', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: true,
        status: 200,
        jsonBody: { id: 'cust_42', name: 'Jane Bowler', email: 'jane@example.com' },
      }),
    );

    const customer = await createSquareCustomer('Jane Bowler', 'jane@example.com', 7);

    expect(customer).toEqual({
      id: 'cust_42',
      name: 'Jane Bowler',
      email: 'jane@example.com',
    });
  });

  it('(b) populates .message, .code, and .status from a structured error body', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 409,
        jsonBody: {
          error: {
            message: 'A customer with this email already exists.',
            code: 'CUSTOMER_EXISTS',
          },
        },
      }),
    );

    const err = await createSquareCustomer('Jane Bowler', 'jane@example.com', 7)
      .then(
        () => {
          throw new Error('helper unexpectedly resolved instead of rejecting');
        },
        (e: unknown) => e as Error & { code?: string; status?: number },
      );

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('A customer with this email already exists.');
    expect(err.code).toBe('CUSTOMER_EXISTS');
    expect(err.status).toBe(409);
    expect(err.message).not.toMatch(/[{}]/);
    expect(err.message).not.toMatch(/"error"/);
  });

  it('(c) falls back to plain-text body for non-JSON responses without leaking JSON', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 500,
        textBody: 'Internal Server Error',
      }),
    );

    const err = await createSquareCustomer('Jane Bowler', 'jane@example.com', 7)
      .then(
        () => {
          throw new Error('helper unexpectedly resolved instead of rejecting');
        },
        (e: unknown) => e as Error,
      );

    expect(err).toBeInstanceOf(Error);
    // The plain-text path goes through the outer catch's "no .code"
    // branch, which prefixes the human-friendly summary. The point of
    // the assertion is that the upstream text survives in `.message`
    // and that no JSON soup leaks through.
    expect(err.message).toContain('Internal Server Error');
    expect(err.message).not.toMatch(/[{}]/);
    expect(err.message).not.toMatch(/"error"/);
  });

  it('(d) preserves PROVIDER_NOT_CONFIGURED end-to-end through the outer catch', async () => {
    csrfFetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 422,
        jsonBody: {
          error: {
            message: "Square isn't connected for this location.",
            code: PROVIDER_NOT_CONFIGURED,
          },
        },
      }),
    );

    const err = await createSquareCustomer('Jane Bowler', 'jane@example.com', 7)
      .then(
        () => {
          throw new Error('helper unexpectedly resolved instead of rejecting');
        },
        (e: unknown) => e as Error & { code?: string; status?: number },
      );

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(PROVIDER_NOT_CONFIGURED);
    expect(err.status).toBe(422);
    expect(err.message).toBe("Square isn't connected for this location.");
    // The outer catch must NOT have wrapped this into a generic
    // "Failed to create Square customer: ..." string, otherwise
    // callers like `providerNotConfiguredToast` lose their signal.
    expect(err.message).not.toMatch(/^Failed to create Square customer:/);
    expect(err.message).not.toMatch(/[{}]/);
  });
});
