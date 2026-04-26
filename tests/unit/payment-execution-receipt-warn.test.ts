/**
 * Task #503 — `executeCharge` (used by autopay/scheduled charges)
 * must:
 *   1. Surface `receiptUrl` / `receiptNumber` from the provider on the
 *      `ChargeResult` so the caller can persist them.
 *   2. Set `buyerEmailMissing=true` and emit a `log.warn` whenever a
 *      Square charge runs without a buyer email — that's the
 *      observability hook ops uses to chase up missing receipts.
 *   3. Leave `buyerEmailMissing=false` for CardPointe (no hosted
 *      receipts are ever emitted) regardless of the email state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const warnSpy = vi.fn();
const fakeLogger = {
  info: vi.fn(),
  warn: (...a: unknown[]) => warnSpy(...a),
  error: vi.fn(),
  debug: vi.fn(),
};
vi.mock('../../server/logger', () => ({
  logger: fakeLogger,
  createLogger: () => fakeLogger,
}));

const { executeCharge } = await import('../../server/services/payment-execution');

beforeEach(() => warnSpy.mockReset());

function makeProvider(name: 'square' | 'cardpointe', overrides: Record<string, unknown> = {}) {
  return {
    providerName: name,
    processPayment: vi.fn().mockResolvedValue({
      id: 'pay_1', status: 'COMPLETED',
      receiptUrl: name === 'square' ? 'https://squareup.com/receipt/preview/pay_1' : undefined,
      receiptNumber: name === 'square' ? 'NUM-001' : undefined,
      providerRef: {},
    }),
    createOrderWithPayment: vi.fn().mockResolvedValue({
      id: 'pay_1', status: 'COMPLETED',
      receiptUrl: name === 'square' ? 'https://squareup.com/receipt/preview/pay_1' : undefined,
      receiptNumber: name === 'square' ? 'NUM-001' : undefined,
      providerRef: {},
    }),
    ...overrides,
  } as unknown as Parameters<typeof executeCharge>[0];
}

describe('executeCharge — receipt fields & missing-email warn (Task #503)', () => {
  it('warns and flags buyerEmailMissing when Square charge has no buyer email', async () => {
    const provider = makeProvider('square');
    const result = await executeCharge(provider, 'card_1', 2000, [], 'cust_1', undefined);

    expect(result.buyerEmailMissing).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    const msg = String(warnSpy.mock.calls[0][0] ?? '');
    expect(msg).toMatch(/without buyer email/i);
  });

  it('returns receiptUrl/receiptNumber from the provider when buyer email present', async () => {
    const provider = makeProvider('square');
    const result = await executeCharge(provider, 'card_1', 2000, [], 'cust_1', 'pat@example.com');

    expect(result.buyerEmailMissing).toBe(false);
    expect(result.receiptUrl).toBe('https://squareup.com/receipt/preview/pay_1');
    expect(result.receiptNumber).toBe('NUM-001');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn for CardPointe charges even without a buyer email (no hosted receipt)', async () => {
    const provider = makeProvider('cardpointe');
    const result = await executeCharge(provider, 'card_1', 2000, [], 'cust_1', undefined);

    expect(result.buyerEmailMissing).toBeFalsy();
    expect(result.receiptUrl).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
