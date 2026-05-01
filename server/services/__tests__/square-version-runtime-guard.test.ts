import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Task #627 — Catch Square SDK header drift in the deployed app, not
 * just CI.
 *
 * Companion to the merge-gating CI test in
 * `square-version-header.test.ts` (task #614). That test catches
 * drift in the lockfile that's about to merge; this one catches
 * drift in the lockfile that's actually running, by exercising the
 * runtime probe (`verifySquareSdkVersion`) and the
 * `getSquareClient()` refusal path it gates.
 *
 * The probe builds a real `SquareClient` with a fake fetcher that
 * captures the outgoing `Square-Version` header — see
 * `defaultProbeSquareSdkVersion` in `server/services/square-provider.ts`
 * for the canonical implementation. Here we override the probe via
 * the `_setSquareSdkVersionProbeForTests` test seam so we can assert
 * each branch (verified, drift, non-conclusive) without standing up
 * a real client per case.
 */

// Module-level mocks. We mock `square` so the production code's
// `import { SquareClient }` resolves to a constructable stub; the
// SquareClient stub is only exercised by the *real* probe (which we
// stub out per-case via `_setSquareSdkVersionProbeForTests`), so its
// shape barely matters. We mock `../../logger` to capture the
// structured drift line.
const mocks = vi.hoisted(() => ({
  getLocationSquareConfig: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('square', () => ({
  SquareClient: function () {
    return { payments: {}, customers: {}, catalog: {}, refunds: {}, cards: {}, applePay: {} };
  },
  SquareEnvironment: { Production: 'production', Sandbox: 'sandbox' },
  SquareError: class SquareError extends Error {},
}));

vi.mock('../../storage', () => ({
  storage: {
    getLocationSquareConfig: (...args: unknown[]) => mocks.getLocationSquareConfig(...args),
  },
}));

vi.mock('../../logger', () => ({
  createLogger: () => mocks.log,
}));

const {
  SquarePaymentProvider,
  SQUARE_EXPECTED_VERSION,
  verifySquareSdkVersion,
  _resetSquareSdkVersionVerificationForTests,
  _setSquareSdkVersionProbeForTests,
} = await import('../square-provider.js');

describe('Square SDK Square-Version runtime guard (task #627)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSquareSdkVersionVerificationForTests();
    mocks.getLocationSquareConfig.mockResolvedValue({
      accessToken: 'EAAAEv-test-token',
      appId: 'sq0idp-test',
      locationId: 'LOC123',
    });
  });

  afterEach(() => {
    _resetSquareSdkVersionVerificationForTests();
  });

  describe('verifySquareSdkVersion', () => {
    it('returns ok:true and logs an info line when the SDK header matches SQUARE_EXPECTED_VERSION', async () => {
      _setSquareSdkVersionProbeForTests(async () => ({
        ok: true,
        version: SQUARE_EXPECTED_VERSION,
      }));

      const result = await verifySquareSdkVersion();

      expect(result).toEqual({ ok: true, version: SQUARE_EXPECTED_VERSION });
      expect(mocks.log.error).not.toHaveBeenCalled();
      expect(mocks.log.info).toHaveBeenCalledWith(
        'Square SDK Square-Version verified at runtime',
        { version: SQUARE_EXPECTED_VERSION, expected: SQUARE_EXPECTED_VERSION },
      );
    });

    it('returns ok:false and emits a paging-priority structured error line when the SDK header drifts', async () => {
      const drifted = '2099-12-31';
      _setSquareSdkVersionProbeForTests(async () => ({
        ok: false,
        version: drifted,
        reason: 'drift',
      }));

      const result = await verifySquareSdkVersion();

      expect(result).toEqual({ ok: false, version: drifted });
      expect(mocks.log.error).toHaveBeenCalledTimes(1);
      const [message, payload] = mocks.log.error.mock.calls[0] ?? [];
      // The on-call grep convention for this codebase is `[PAGE]`
      // prefixed `error` lines — keep the assertion strict so a
      // future log-format refactor that drops the prefix is loud.
      expect(message).toMatch(/^\[PAGE\] /);
      expect(message).toMatch(/Square-Version header drift/);
      expect(payload).toMatchObject({
        expected: SQUARE_EXPECTED_VERSION,
        actual: drifted,
        runbook: 'docs/square-api-version-audit.md §6',
      });
      // Remediation pointer must be present so the responder can fix
      // it without first re-reading the audit doc.
      expect((payload as { remediation?: unknown })?.remediation).toBeTypeOf('string');
    });

    it('also emits the structured error line when the header is missing entirely (probe captured but header absent)', async () => {
      _setSquareSdkVersionProbeForTests(async () => ({
        ok: false,
        version: undefined,
        reason: 'drift',
      }));

      const result = await verifySquareSdkVersion();

      expect(result).toEqual({ ok: false, version: undefined });
      const [, payload] = mocks.log.error.mock.calls[0] ?? [];
      expect(payload).toMatchObject({
        expected: SQUARE_EXPECTED_VERSION,
        // `null` (not `undefined`) so the line round-trips cleanly
        // through the JSON-serializing logger sink.
        actual: null,
      });
    });

    it('treats a probe that could not capture as non-conclusive (does NOT refuse to initialize)', async () => {
      _setSquareSdkVersionProbeForTests(async () => ({
        ok: true,
        version: undefined,
        reason: 'no-captured-request',
      }));

      const result = await verifySquareSdkVersion();

      expect(result).toEqual({ ok: true, version: undefined });
      // No paging line — non-conclusive must not look like drift.
      expect(mocks.log.error).not.toHaveBeenCalled();
      // Logged at info, not warn, so the noise from
      // legitimately-mocked SDKs in unit tests doesn't drown out
      // real prod drift.
      expect(mocks.log.info).toHaveBeenCalledWith(
        expect.stringContaining('runtime version check skipped'),
      );
    });

    it('memoizes the probe so concurrent and repeat callers all see the same result', async () => {
      const probe = vi.fn(async () => ({ ok: true as const, version: SQUARE_EXPECTED_VERSION }));
      _setSquareSdkVersionProbeForTests(probe);

      const [a, b, c] = await Promise.all([
        verifySquareSdkVersion(),
        verifySquareSdkVersion(),
        verifySquareSdkVersion(),
      ]);
      const d = await verifySquareSdkVersion();

      expect(probe).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
      expect(b).toEqual(c);
      expect(c).toEqual(d);
    });
  });

  describe('SquarePaymentProvider.getSquareClient drift refusal', () => {
    it('returns null and skips credential lookup when the runtime guard reports drift', async () => {
      _setSquareSdkVersionProbeForTests(async () => ({
        ok: false,
        version: '2099-12-31',
        reason: 'drift',
      }));

      const provider = new SquarePaymentProvider(1);
      // `processPayment` is the easiest public path to trip the
      // private `getSquareClient`. With drift, we expect a structured
      // `ProviderNotConfiguredError` (the same null-client contract
      // a missing `accessToken` would produce) rather than a real
      // SDK call.
      await expect(provider.processPayment('cnon-test', 100)).rejects.toMatchObject({
        name: 'ProviderNotConfiguredError',
      });

      // Credentials must NOT have been fetched — the drift check
      // gates the credential lookup, not the other way around. If
      // this assertion ever flips, drift would be discoverable
      // only on locations that are actually Square-configured,
      // which defeats the boot-time guarantee.
      expect(mocks.getLocationSquareConfig).not.toHaveBeenCalled();

      // The per-call refusal log must point at the runbook so the
      // on-call has the same recovery path as the boot-time line.
      const refusal = mocks.log.error.mock.calls.find((call) =>
        typeof call[0] === 'string' && call[0].includes('Refusing Square client'),
      );
      expect(refusal).toBeDefined();
      expect(refusal?.[0]).toMatch(/docs\/square-api-version-audit\.md §6/);
    });

    it('proceeds with the normal credential lookup when the runtime guard passes', async () => {
      _setSquareSdkVersionProbeForTests(async () => ({
        ok: true,
        version: SQUARE_EXPECTED_VERSION,
      }));

      const provider = new SquarePaymentProvider(1);
      // We don't care what processPayment returns here — only that
      // the credential lookup ran (i.e. we didn't short-circuit on
      // drift) and no refusal-error was logged.
      await provider.processPayment('cnon-test', 100).catch(() => undefined);

      expect(mocks.getLocationSquareConfig).toHaveBeenCalledWith(1);
      const refusal = mocks.log.error.mock.calls.find((call) =>
        typeof call[0] === 'string' && call[0].includes('Refusing Square client'),
      );
      expect(refusal).toBeUndefined();
    });
  });
});
