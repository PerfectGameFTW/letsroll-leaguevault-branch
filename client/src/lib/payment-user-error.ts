/**
 * Frontend mirror of the server-side `sanitizePaymentUserMessage`
 * helper (task #514). Single function that decides what string a
 * payment-failure toast actually shows the user.
 *
 * Use it everywhere a payment-related catch block builds a toast
 * description from `error.message`. It guarantees that even if a new
 * code path forgets to map its error to a friendly sentence — or if a
 * legacy JSON-encoded payload sneaks through — the user sees a clean
 * sentence instead of `{...}`, a stack-trace fragment, or raw provider
 * jargon.
 *
 * Rules (kept intentionally identical to the server-side sanitizer):
 *   - non-string / null / undefined / whitespace-only -> generic
 *   - starts with `{` or `[` (JSON-shaped)              -> generic
 *   - contains a newline (multi-line stack frame)       -> generic
 *   - longer than 200 chars (likely raw provider detail) -> generic
 */
export const GENERIC_PAYMENT_ERROR_MESSAGE =
  'Payment could not be processed. Please try again.';

export function sanitizePaymentErrorMessage(
  input: unknown,
  fallback: string = GENERIC_PAYMENT_ERROR_MESSAGE,
): string {
  let msg: string | undefined;
  if (input instanceof Error) {
    msg = input.message;
  } else if (typeof input === 'string') {
    msg = input;
  }
  if (typeof msg !== 'string') return fallback;
  const trimmed = msg.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return fallback;
  if (trimmed.includes('\n') || trimmed.includes('\r')) return fallback;
  if (trimmed.length > 200) return fallback;
  return trimmed;
}
