/**
 * Unit pin for task #514.
 *
 * Task #514 replaced the `throw new Error(JSON.stringify({ error: ... }))`
 * pattern in the Square provider with a typed `PaymentProviderError`,
 * and added a final-safety-net sanitizer on both the server route and
 * the frontend toast paths. The sanitizers are the last line of
 * defense: even if a future code path forgets the typed error and
 * lands a raw JSON / stack-trace fragment / huge provider-detail
 * string in the user-visible `message` field, the sanitizer must swap
 * it out for the generic friendly fallback.
 *
 * Without this pin a future refactor that loosens any of those
 * checks (e.g. drops the `startsWith('{')` guard) would silently
 * regress task #514's "no JSON in user-facing toasts" guarantee.
 */
import { describe, expect, it } from 'vitest';
import {
  sanitizePaymentUserMessage,
  GENERIC_PAYMENT_USER_MESSAGE,
} from '../../server/services/payment-provider-factory';
import {
  sanitizePaymentErrorMessage,
  GENERIC_PAYMENT_ERROR_MESSAGE,
} from '../../client/src/lib/payment-user-error';

describe('sanitizePaymentUserMessage (server, task #514)', () => {
  it('returns hand-authored sentences unchanged', () => {
    expect(
      sanitizePaymentUserMessage('Your payment was declined. Please try a different card.'),
    ).toBe('Your payment was declined. Please try a different card.');
  });

  it('swaps in the generic fallback for JSON-shaped strings', () => {
    expect(
      sanitizePaymentUserMessage('{"error":{"message":"oh no","code":"PAYMENT_FAILED"}}'),
    ).toBe(GENERIC_PAYMENT_USER_MESSAGE);
    expect(sanitizePaymentUserMessage('[1,2,3]')).toBe(GENERIC_PAYMENT_USER_MESSAGE);
  });

  it('swaps in the generic fallback for multi-line strings (stack-trace fragments)', () => {
    expect(
      sanitizePaymentUserMessage('SquareApiError: bad\n    at /app/server/services/square.ts:42'),
    ).toBe(GENERIC_PAYMENT_USER_MESSAGE);
  });

  it('swaps in the generic fallback for empty / non-string / oversized inputs', () => {
    expect(sanitizePaymentUserMessage('')).toBe(GENERIC_PAYMENT_USER_MESSAGE);
    expect(sanitizePaymentUserMessage('   ')).toBe(GENERIC_PAYMENT_USER_MESSAGE);
    expect(sanitizePaymentUserMessage(undefined)).toBe(GENERIC_PAYMENT_USER_MESSAGE);
    expect(sanitizePaymentUserMessage(null)).toBe(GENERIC_PAYMENT_USER_MESSAGE);
    expect(sanitizePaymentUserMessage({ error: 'object' })).toBe(GENERIC_PAYMENT_USER_MESSAGE);
    expect(sanitizePaymentUserMessage('x'.repeat(201))).toBe(GENERIC_PAYMENT_USER_MESSAGE);
  });
});

describe('sanitizePaymentErrorMessage (frontend, task #514)', () => {
  it('extracts a clean message from an Error instance', () => {
    expect(
      sanitizePaymentErrorMessage(new Error('Your card was declined. Please try another.')),
    ).toBe('Your card was declined. Please try another.');
  });

  it('swaps in the fallback when an Error carries a JSON-shaped message', () => {
    expect(
      sanitizePaymentErrorMessage(
        new Error('{"error":{"message":"oh no","code":"PAYMENT_FAILED"}}'),
      ),
    ).toBe(GENERIC_PAYMENT_ERROR_MESSAGE);
  });

  it('uses the caller-provided fallback for non-Error / non-string inputs', () => {
    expect(sanitizePaymentErrorMessage(undefined, 'My fallback')).toBe('My fallback');
    expect(sanitizePaymentErrorMessage({ foo: 'bar' }, 'My fallback')).toBe('My fallback');
    expect(sanitizePaymentErrorMessage(42, 'My fallback')).toBe('My fallback');
  });

  it('rejects multi-line and oversized messages', () => {
    expect(
      sanitizePaymentErrorMessage(new Error('boom\n  at thing'), 'fb'),
    ).toBe('fb');
    expect(sanitizePaymentErrorMessage('x'.repeat(500), 'fb')).toBe('fb');
  });

  it('accepts a plain string message', () => {
    expect(sanitizePaymentErrorMessage('Insufficient funds.')).toBe('Insufficient funds.');
  });
});
