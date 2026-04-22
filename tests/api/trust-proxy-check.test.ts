/**
 * Pins the boot-time trust-proxy guard introduced for task #326.
 *
 * The check is the only thing standing between a misconfigured proxy
 * deploy and `setupAdminLimiter` silently turning into a 5 req / 15 min
 * cap for the whole internet (because every request would key on the
 * proxy's loopback address). These tests assert the helper:
 *   - approves the production setting (`trust proxy = 1`),
 *   - rejects the "trust nothing" default (req.ip → loopback),
 *   - throws in production but only warns in dev when misconfigured.
 */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import {
  verifyTrustProxy,
  assertTrustProxyAtBoot,
} from '../../server/lib/trust-proxy-check';

function makeLog() {
  return { error: vi.fn(), warn: vi.fn() };
}

describe('verifyTrustProxy', () => {
  it("approves trust proxy = 1 (the production setting): req.ip resolves to the leftmost XFF client", () => {
    const app = express();
    app.set('trust proxy', 1);
    const result = verifyTrustProxy(app);
    expect(result.ok).toBe(true);
    expect(result.resolvedIp).toBe('203.0.113.7');
  });

  it("rejects the default (no trust proxy): req.ip stays at loopback so per-IP limiters collapse into a global cap", () => {
    // No app.set('trust proxy', ...) — Express defaults to "trust no
    // proxy", which means proxy-addr ignores X-Forwarded-For entirely
    // and req.ip is whatever the socket address is (loopback in our
    // synthetic request).
    const app = express();
    const result = verifyTrustProxy(app);
    expect(result.ok).toBe(false);
    expect(result.resolvedIp).toBe('127.0.0.1');
    expect(result.reason).toMatch(/loopback|private/i);
  });

  it("rejects trust proxy = 0 explicitly", () => {
    const app = express();
    app.set('trust proxy', 0);
    const result = verifyTrustProxy(app);
    expect(result.ok).toBe(false);
    expect(result.resolvedIp).toBe('127.0.0.1');
  });
});

describe('assertTrustProxyAtBoot', () => {
  it('throws in production when trust-proxy is misconfigured', () => {
    const app = express();
    // Intentionally do NOT set trust proxy — simulate a future deploy
    // that forgot to configure it for the new proxy topology.
    const log = makeLog();
    expect(() =>
      assertTrustProxyAtBoot(app, { isProduction: true, log }),
    ).toThrow(/Trust-proxy misconfigured/);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("only warns (does not throw) in dev when misconfigured, so the dev loop isn't broken", () => {
    const app = express();
    const log = makeLog();
    const result = assertTrustProxyAtBoot(app, { isProduction: false, log });
    expect(result.ok).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("returns ok and logs nothing when configured correctly, in either environment", () => {
    const app = express();
    app.set('trust proxy', 1);
    const log = makeLog();
    const result = assertTrustProxyAtBoot(app, { isProduction: true, log });
    expect(result.ok).toBe(true);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
