/**
 * Unit tests for the shared payment-provider error mapping helper
 * (task #605).
 *
 * The helper is the single point that the charge, refund, save-card,
 * remove-card, autopay/schedule-execution, customer-deletion, and
 * resend-receipt routes now collapse to. The three branches it pins
 * (PNCE → 422, typed PaymentProviderError → 500 with userMessage+code,
 * else → 500 with the caller fallback) MUST stay stable because every
 * one of those routes encodes their public envelope contract through
 * this helper. A regression here silently widens (or narrows) the
 * envelope on six different routes at once.
 *
 * The sanitizer wiring is also pinned: `userMessage` (typed branch)
 * and `fallbackMessage` (else branch) BOTH go through
 * `sanitizePaymentUserMessage`, so a future call site that forwards
 * `error.message` (containing JSON / a stack trace / a multi-line
 * provider blob) into `fallbackMessage` cannot leak it to the client.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPaymentErrorResponse,
  PROVIDER_NOT_CONFIGURED_USER_MESSAGE,
} from '../payment-error-response';
import {
  GENERIC_PAYMENT_USER_MESSAGE,
  PaymentProviderError,
  ProviderNotConfiguredError,
} from '../../services/payment-provider-factory';

describe('buildPaymentErrorResponse', () => {
  describe('ProviderNotConfiguredError branch (422 PROVIDER_NOT_CONFIGURED)', () => {
    it('maps PNCE to 422 with the unified user message and PROVIDER_NOT_CONFIGURED code', () => {
      // The location id / processor name in the PNCE constructor must
      // NOT leak into `userMessage` — the helper substitutes a fixed
      // sentence so admins on every payment route get the same
      // "provider isn't connected for this location" signal without
      // leaking which location or which processor was attempted.
      const res = buildPaymentErrorResponse(
        new ProviderNotConfiguredError('Square is not configured for location 99', 99),
        'fallback should not be used',
        'FALLBACK_CODE',
      );

      expect(res).toEqual({
        status: 422,
        userMessage: PROVIDER_NOT_CONFIGURED_USER_MESSAGE,
        code: 'PROVIDER_NOT_CONFIGURED',
      });
    });

    it('uses the unified user message even when PNCE.message is empty / null-ish', () => {
      // Even an empty reason string must produce the canonical
      // sentence — the helper never reads `error.message` for the
      // user-facing copy on this branch.
      const res = buildPaymentErrorResponse(
        new ProviderNotConfiguredError('', null),
        'fallback',
        'FALLBACK_CODE',
      );

      expect(res.userMessage).toBe(PROVIDER_NOT_CONFIGURED_USER_MESSAGE);
      expect(res.status).toBe(422);
      expect(res.code).toBe('PROVIDER_NOT_CONFIGURED');
    });

    it('exports the canonical PROVIDER_NOT_CONFIGURED_USER_MESSAGE constant', () => {
      // Pin the literal — the front-end and various e2e specs rely on
      // recognising this exact sentence; a silent rewording (e.g.
      // back to "Payment system is not configured…") would break the
      // unified copy this task introduced.
      expect(PROVIDER_NOT_CONFIGURED_USER_MESSAGE).toBe(
        'Payment provider is not configured for this location',
      );
    });
  });

  describe('PaymentProviderError branch (500 with typed userMessage + code)', () => {
    it('returns 500 with the typed userMessage and code (not the fallback)', () => {
      // The typed error wins over the fallback — that's the whole
      // point of PaymentProviderError carrying the hand-authored
      // user-facing sentence + machine code.
      const res = buildPaymentErrorResponse(
        new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          'do_not_honor',
        ),
        'Failed to process refund',
        'REFUND_ERROR',
      );

      expect(res).toEqual({
        status: 500,
        userMessage: 'Your payment was declined. Please try a different card.',
        code: 'PAYMENT_DECLINED',
      });
    });

    it('runs PaymentProviderError.userMessage through sanitizePaymentUserMessage', () => {
      // A mis-typed JSON-shaped userMessage must be replaced with the
      // generic fallback sentence. The code is preserved (machine
      // contract for the client) but the user-facing copy is scrubbed.
      const res = buildPaymentErrorResponse(
        new PaymentProviderError('{"leak":"json"}', 'BAD_REQUEST'),
        'fallback',
        'FALLBACK_CODE',
      );

      expect(res.status).toBe(500);
      expect(res.userMessage).toBe(GENERIC_PAYMENT_USER_MESSAGE);
      expect(res.code).toBe('BAD_REQUEST');
    });

    it('scrubs multi-line PaymentProviderError.userMessage (stack-trace fragment) via sanitizer', () => {
      // Multi-line strings are the classic shape of a leaked stack
      // trace. The sanitizer must collapse them to the generic
      // fallback so admins never see "Error\n  at /server/...".
      const res = buildPaymentErrorResponse(
        new PaymentProviderError('boom\n  at /server/foo.ts:1', 'SYSTEM_ERROR'),
        'fallback',
        'FALLBACK_CODE',
      );

      expect(res.userMessage).toBe(GENERIC_PAYMENT_USER_MESSAGE);
      expect(res.code).toBe('SYSTEM_ERROR');
    });
  });

  describe('Fallback branch (500 with caller-supplied message + code)', () => {
    it('returns 500 with the caller fallback for a plain Error', () => {
      // Untyped errors must fall through to the caller's fallback
      // string + code so each route keeps its legacy public envelope
      // ("Failed to save card", "Failed to resend receipt", etc.)
      // without the helper picking a one-size-fits-all sentence.
      const res = buildPaymentErrorResponse(
        new Error('boom: undefined is not a function\n  at /server/foo.ts:1'),
        'Failed to save card',
        'CARD_SAVE_ERROR',
      );

      expect(res).toEqual({
        status: 500,
        userMessage: 'Failed to save card',
        code: 'CARD_SAVE_ERROR',
      });
    });

    it('handles non-Error throws (string, null, undefined) without leaking them', () => {
      // `throw 'boom'` / `throw null` / etc. must still resolve to the
      // caller fallback — the helper never inspects the value beyond
      // the two `instanceof` checks for non-Error inputs.
      for (const thrown of ['plain string', null, undefined, 42, { error: 'leak' }]) {
        const res = buildPaymentErrorResponse(thrown, 'Failed to remove card', 'REMOVE_CARD_ERROR');
        expect(res).toEqual({
          status: 500,
          userMessage: 'Failed to remove card',
          code: 'REMOVE_CARD_ERROR',
        });
      }
    });

    it('runs the fallback message through sanitizePaymentUserMessage as a final safety net', () => {
      // Future call sites must not be able to accidentally leak a
      // stringified provider payload by passing `error.message` as
      // the fallback. The sanitizer enforces that even at the
      // fallback layer.
      const res = buildPaymentErrorResponse(
        new Error('original'),
        '{"leak":"raw provider payload"}',
        'FALLBACK_CODE',
      );

      expect(res.userMessage).toBe(GENERIC_PAYMENT_USER_MESSAGE);
      expect(res.code).toBe('FALLBACK_CODE');
      expect(res.status).toBe(500);
    });

    it('scrubs multi-line fallback message via the sanitizer', () => {
      const res = buildPaymentErrorResponse(
        new Error('original'),
        'first line\nsecond line',
        'FALLBACK_CODE',
      );

      expect(res.userMessage).toBe(GENERIC_PAYMENT_USER_MESSAGE);
      expect(res.code).toBe('FALLBACK_CODE');
    });
  });

  describe('branch ordering invariants', () => {
    it('PNCE branch wins over the PaymentProviderError branch (subclass check would inverse this)', () => {
      // PNCE and PaymentProviderError are sibling Error subclasses,
      // not a hierarchy — but if a future refactor accidentally makes
      // PNCE extend PaymentProviderError, the helper's order
      // (PNCE first) is what keeps PNCE producing 422 instead of 500.
      // This test pins the order so that refactor would fail loudly.
      const pnce = new ProviderNotConfiguredError('reason', 7);
      const res = buildPaymentErrorResponse(pnce, 'fallback', 'FALLBACK_CODE');
      expect(res.status).toBe(422);
      expect(res.code).toBe('PROVIDER_NOT_CONFIGURED');
    });

    it('PaymentProviderError branch wins over the fallback branch', () => {
      // Sanity: a typed error must never silently degrade into the
      // caller's generic fallback — that would erase the actionable
      // signal (e.g. "card declined" → "failed to process refund").
      const typed = new PaymentProviderError('declined', 'PAYMENT_DECLINED');
      const res = buildPaymentErrorResponse(typed, 'Failed to process refund', 'REFUND_ERROR');
      expect(res.userMessage).toBe('declined');
      expect(res.code).toBe('PAYMENT_DECLINED');
    });
  });
});
