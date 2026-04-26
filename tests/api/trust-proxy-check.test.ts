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
  isPrivateOrLoopback,
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

// Direct coverage of the CIDR-aware private/loopback classifier
// (task #380). Before this rewrite the helper used a string-prefix
// list — `["fc", "fd", ...]` — that would have falsely classified
// any string starting with those letters as an IPv6 unique-local
// address. The cases below pin both the legitimate matches AND the
// bait inputs the prefix version would have gotten wrong.
describe('isPrivateOrLoopback', () => {
  describe('IPv4 private / loopback / link-local ranges → true', () => {
    it.each([
      ['127.0.0.1', 'loopback'],
      ['127.255.255.254', 'loopback (full /8)'],
      ['10.0.0.1', 'RFC1918 10/8'],
      ['172.16.0.1', 'RFC1918 172.16/12 lower bound'],
      ['172.31.255.255', 'RFC1918 172.16/12 upper bound'],
      ['192.168.1.1', 'RFC1918 192.168/16'],
      ['169.254.1.1', 'link-local 169.254/16'],
      ['0.0.0.0', 'unspecified'],
    ])('%s (%s)', (ip) => {
      expect(isPrivateOrLoopback(ip)).toBe(true);
    });
  });

  describe('IPv4 public ranges → false', () => {
    it.each([
      ['203.0.113.7', 'TEST-NET-3 (the synthetic client we use throughout the boot guard)'],
      ['8.8.8.8', 'arbitrary public IPv4'],
      ['172.32.0.1', 'just outside the 172.16/12 RFC1918 block'],
      ['172.15.255.255', 'just below the 172.16/12 RFC1918 block'],
      ['11.0.0.1', 'one-off above 10/8'],
      ['192.169.0.1', 'just outside 192.168/16'],
    ])('%s (%s)', (ip) => {
      expect(isPrivateOrLoopback(ip)).toBe(false);
    });
  });

  describe('IPv6 loopback / unique-local / link-local → true', () => {
    it.each([
      ['::1', 'IPv6 loopback'],
      ['::', 'IPv6 unspecified'],
      ['fc00::1', 'IPv6 unique-local (fc00::/7) lower'],
      ['fcff::ff', 'IPv6 unique-local (fc00::/7) middle'],
      ['fd00::1', 'IPv6 unique-local (fd00::/7)'],
      ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'IPv6 unique-local upper bound'],
      ['fe80::1', 'IPv6 link-local (fe80::/10)'],
      ['febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'IPv6 link-local upper bound'],
    ])('%s (%s)', (ip) => {
      expect(isPrivateOrLoopback(ip)).toBe(true);
    });
  });

  describe('IPv6 public ranges → false', () => {
    it.each([
      ['2001:db8::1', 'documentation prefix (still classed as global by ipaddr.js)'],
      ['2606:4700:4700::1111', 'Cloudflare public DNS over IPv6'],
      ['fb00::1', "just below fc00::/7 (was previously caught by bare 'f' isn't a thing, but we want it through)"],
      ['fec0::1', 'site-local — deprecated by RFC3879 but should not match link-local'],
    ])('%s (%s)', (ip) => {
      expect(isPrivateOrLoopback(ip)).toBe(false);
    });
  });

  describe('IPv4-mapped IPv6 unwraps to its embedded IPv4', () => {
    it('::ffff:127.0.0.1 → true (loopback under the wrapper)', () => {
      expect(isPrivateOrLoopback('::ffff:127.0.0.1')).toBe(true);
    });
    it('::ffff:10.0.0.1 → true (RFC1918 under the wrapper)', () => {
      expect(isPrivateOrLoopback('::ffff:10.0.0.1')).toBe(true);
    });
    it('::ffff:8.8.8.8 → false (public IPv4 under the wrapper)', () => {
      expect(isPrivateOrLoopback('::ffff:8.8.8.8')).toBe(false);
    });
  });

  describe('Unparseable / sentinel inputs → true (fail-closed)', () => {
    // The whole point of task #380: the prefix-based predecessor
    // would have flipped these to `true` for a completely wrong
    // reason ("starts with fc/fd"), and worse — the rest of the
    // module would have flowed `verifyTrustProxy` through the
    // "looks like a private address" branch and surfaced a
    // misleading error message. The CIDR-aware version still
    // returns `true` (fail-closed), but does so explicitly because
    // the input failed `ipaddr.isValid`, not because it accidentally
    // pattern-matched a real range.
    it.each([
      ['fcat', "starts with 'fc' but isn't an IPv6 ULA"],
      ['fdoozle', "starts with 'fd' but isn't an IPv6 ULA"],
      ['fe80x', "starts with 'fe80' but isn't a valid IPv6"],
      ['127garbage', "starts with '127' but isn't a valid IPv4"],
      ['not-an-ip', 'pure garbage'],
      ['', 'empty string'],
      ['unknown', 'proxy-addr sentinel'],
    ])('%s (%s) → true', (ip) => {
      expect(isPrivateOrLoopback(ip)).toBe(true);
    });
  });
});
