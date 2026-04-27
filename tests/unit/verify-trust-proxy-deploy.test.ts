/**
 * Unit tests for `scripts/verify-trust-proxy-deploy.ts` (task #499).
 *
 * The script is what a deploy pipeline runs *after* the new version
 * is healthy to confirm the live trust-proxy contract still holds.
 * If `req.ip` collapses back to the proxy's loopback address every
 * per-IP rate limiter — most importantly the 5 req / 15 min
 * `setupAdminLimiter` — silently turns into a global ceiling for the
 * entire internet (see `server/lib/trust-proxy-check.ts` for the
 * full rationale). The endpoint side is covered by
 * `tests/api/system-admin-trust-proxy-status.test.ts`; this file
 * pins the script's *own* logic so a future agent refactoring it
 * (inverting an assertion, dropping an exit-code branch, loosening
 * the inline matcher) trips a loud failure instead of a silently
 * green smoke check.
 *
 * Coverage:
 *   - `BASE_URL` missing → exit 2 (config error, not assertion fail)
 *   - `ADMIN_COOKIE` missing → exit 2
 *   - HTTP non-200 from the probe endpoint → exit 1
 *   - `synthetic.ok=false` from the endpoint → exit 1
 *   - `live.resolvedIp` is loopback / RFC1918 / link-local → exit 1
 *     (asserted for every prefix the inline matcher must reject)
 *   - `EXPECTED_RESOLVED_IP` mismatch → exit 1
 *   - Green path → no `process.exit` thrown
 *   - Inline `isPrivateOrLoopback` agrees with the server's
 *     CIDR-aware classifier on a fixed table of IPs, so a future
 *     tightening of the server matcher (follow-up #380) trips a
 *     failure here instead of drifting silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  runVerifier,
  isPrivateOrLoopback as inlineIsPrivateOrLoopback,
} from '../../scripts/verify-trust-proxy-deploy';
import { isPrivateOrLoopback as serverIsPrivateOrLoopback } from '../../server/lib/trust-proxy-check';

interface ProbeData {
  live: {
    resolvedIp: string | null;
    socketRemoteAddress: string | null;
    xForwardedFor: string | null;
    protocol: string;
    hostname: string;
  };
  config: { trustProxySetting: unknown };
  synthetic: { ok: boolean; resolvedIp: string; reason: string | null };
}

function happyEnv(over: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    BASE_URL: 'https://app.example.com',
    ADMIN_COOKIE: 'connect.sid=s%3Aabc',
    ...over,
  };
}

function happyData(over: Partial<ProbeData> = {}): ProbeData {
  return {
    live: {
      resolvedIp: '203.0.113.7',
      socketRemoteAddress: '127.0.0.1',
      xForwardedFor: '203.0.113.7',
      protocol: 'https',
      hostname: 'app.example.com',
    },
    config: { trustProxySetting: 1 },
    synthetic: { ok: true, resolvedIp: '203.0.113.7', reason: null },
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let exitSpy: MockInstance<(code?: number | string | null) => never>;
let fetchSpy: MockInstance<typeof fetch>;
let errorSpy: MockInstance<typeof console.error>;
let logSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  // Re-throw with a recognisable shape so each test can assert which
  // exit code was requested. The script's `fail()` is typed `never`
  // because `process.exit` is `never`; throwing here preserves that
  // control flow (no fall-through into the success branches).
  exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation((code?: number | string | null) => {
      throw new Error(`__EXIT__:${code ?? 0}`);
    });
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  // Silence the script's stderr/stdout chatter so test output stays
  // legible. We still assert against console.error contents below.
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  exitSpy.mockRestore();
  fetchSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
  vi.clearAllMocks();
});

describe('runVerifier — env validation (exit 2)', () => {
  it('exits 2 when BASE_URL is missing', async () => {
    await expect(runVerifier({ ADMIN_COOKIE: 'x' })).rejects.toThrow('__EXIT__:2');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/BASE_URL is required/);
  });

  it('exits 2 when BASE_URL is whitespace-only (treated as missing)', async () => {
    await expect(runVerifier({ BASE_URL: '   ', ADMIN_COOKIE: 'x' })).rejects.toThrow(
      '__EXIT__:2',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('exits 2 when both PROBE_TOKEN and ADMIN_COOKIE are missing', async () => {
    await expect(runVerifier({ BASE_URL: 'https://app.example.com' })).rejects.toThrow(
      '__EXIT__:2',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    // The script accepts either credential — PROBE_TOKEN (preferred,
    // no rotation) or ADMIN_COOKIE (legacy, ~24h). The error mentions
    // both; pin the regex to that disjunction so a future tweak to
    // either label still satisfies the assertion.
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/PROBE_TOKEN.*ADMIN_COOKIE.*is required/);
  });
});

describe('runVerifier — endpoint failures (exit 1)', () => {
  it('exits 1 when the probe endpoint returns a non-200', async () => {
    fetchSpy.mockResolvedValue(new Response('upstream broke', { status: 502 }));
    await expect(runVerifier(happyEnv())).rejects.toThrow('__EXIT__:1');
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/HTTP 502/);
  });

  it('exits 1 when fetch itself throws (network / DNS error)', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(runVerifier(happyEnv())).rejects.toThrow('__EXIT__:1');
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/request failed.*ECONNREFUSED/);
  });

  it('exits 1 when synthetic.ok is false (boot-guard would have rejected this config)', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        success: true,
        data: happyData({
          synthetic: {
            ok: false,
            resolvedIp: '127.0.0.1',
            reason: 'trust-proxy ate the XFF',
          },
        }),
      }),
    );
    await expect(runVerifier(happyEnv())).rejects.toThrow('__EXIT__:1');
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/synthetic probe failed/);
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/trust-proxy ate the XFF/);
  });

  // Each prefix in PRIVATE_OR_LOOPBACK_PREFIXES (and the 172.16/12
  // regex) is exercised here — if a future refactor drops one, this
  // table fails loudly. The exhaustive list keeps the inline matcher
  // honest about the contract: every one of these resolved live IPs
  // means the proxy is eating XFF and per-IP limiters have collapsed.
  describe('exits 1 when live.resolvedIp resolves to a loopback / private address', () => {
    it.each([
      ['127.0.0.1', 'IPv4 loopback'],
      ['10.1.2.3', 'RFC1918 10/8'],
      ['172.16.0.1', 'RFC1918 172.16/12 lower bound'],
      ['172.20.5.5', 'RFC1918 172.16/12 middle'],
      ['172.31.255.254', 'RFC1918 172.16/12 upper bound'],
      ['192.168.1.1', 'RFC1918 192.168/16'],
      ['169.254.10.10', 'link-local 169.254/16'],
      ['::1', 'IPv6 loopback'],
      ['fe80::1', 'IPv6 link-local'],
      ['fc00::1', 'IPv6 unique-local (fc/7)'],
      ['fd12::abcd', 'IPv6 unique-local (fd/7)'],
      ['unknown', 'proxy-addr sentinel'],
      ['', 'empty string (live block had no resolvedIp)'],
    ])('rejects %s (%s)', async (ip) => {
      fetchSpy.mockResolvedValue(
        jsonResponse({
          success: true,
          data: happyData({
            live: {
              resolvedIp: ip,
              socketRemoteAddress: '127.0.0.1',
              xForwardedFor: '203.0.113.7',
              protocol: 'https',
              hostname: 'app.example.com',
            },
          }),
        }),
      );
      await expect(runVerifier(happyEnv())).rejects.toThrow('__EXIT__:1');
      expect(errorSpy.mock.calls[0]?.[0]).toMatch(/loopback\/private address/);
    });
  });

  it('exits 1 when EXPECTED_RESOLVED_IP does not match live.resolvedIp', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        success: true,
        data: happyData({
          live: {
            resolvedIp: '203.0.113.7',
            socketRemoteAddress: '127.0.0.1',
            xForwardedFor: '203.0.113.7',
            protocol: 'https',
            hostname: 'app.example.com',
          },
        }),
      }),
    );
    await expect(
      runVerifier(happyEnv({ EXPECTED_RESOLVED_IP: '198.51.100.42' })),
    ).rejects.toThrow('__EXIT__:1');
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/does not match EXPECTED_RESOLVED_IP/);
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/198\.51\.100\.42/);
  });

  it('exits 1 when the response body is not the success shape', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ success: false, error: { message: 'no admin session' } }),
    );
    await expect(runVerifier(happyEnv())).rejects.toThrow('__EXIT__:1');
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/response not successful/);
  });
});

describe('runVerifier — green path', () => {
  it('returns without throwing when every assertion passes', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ success: true, data: happyData() }));
    await expect(runVerifier(happyEnv())).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    // The OK breadcrumb is the only thing the script writes when
    // it's happy; we pin it so a silent-on-success regression
    // (which would make pipeline failures harder to debug) fails.
    expect(logSpy.mock.calls.flat().join('\n')).toMatch(/OK — live\.resolvedIp=203\.0\.113\.7/);
  });

  it('accepts an exact EXPECTED_RESOLVED_IP match', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ success: true, data: happyData() }));
    await expect(
      runVerifier(happyEnv({ EXPECTED_RESOLVED_IP: '203.0.113.7' })),
    ).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('sends the admin Cookie header to the probe endpoint', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ success: true, data: happyData() }));
    await runVerifier(happyEnv({ ADMIN_COOKIE: 'connect.sid=s%3Adeadbeef' }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://app.example.com/api/system-admin/trust-proxy-status');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Cookie).toBe('connect.sid=s%3Adeadbeef');
  });
});

// Pins the inline classifier the script ships against the server's
// CIDR-aware source of truth. The script's copy is intentionally
// smaller (no proxy-addr / Express dep so it can run from a minimal
// CI image — it only pulls `ipaddr.js`, which is a regular runtime
// dep already installed by `npm ci` in the post-deploy workflow),
// but the two MUST agree on the realistic inputs the post-deploy
// probe will actually see; otherwise the script will silently
// disagree with the boot guard about what counts as a real client
// IP. Task #380 tightened the server matcher to be CIDR-aware and
// task #502 propagated the same logic into the inline copy — this
// table catches any future drift between them by asserting both
// classifiers return the same answer for every input.
describe('inline isPrivateOrLoopback agrees with server/lib/trust-proxy-check.ts', () => {
  describe('both classify as PRIVATE / LOOPBACK', () => {
    it.each([
      ['127.0.0.1', 'IPv4 loopback'],
      ['127.255.255.254', 'IPv4 loopback (full /8)'],
      ['10.0.0.1', 'RFC1918 10/8 lower'],
      ['10.255.255.254', 'RFC1918 10/8 upper'],
      ['172.16.0.1', 'RFC1918 172.16/12 lower'],
      ['172.20.5.5', 'RFC1918 172.16/12 middle'],
      ['172.31.255.254', 'RFC1918 172.16/12 upper'],
      ['192.168.0.1', 'RFC1918 192.168/16 lower'],
      ['192.168.255.254', 'RFC1918 192.168/16 upper'],
      ['169.254.1.1', 'link-local 169.254/16'],
      ['::1', 'IPv6 loopback'],
      ['fc00::1', 'IPv6 unique-local fc/7'],
      ['fd00::1', 'IPv6 unique-local fd/7'],
      ['fe80::1', 'IPv6 link-local fe80::'],
      ['unknown', 'proxy-addr sentinel'],
      ['', 'empty string'],
    ])('%s (%s)', (ip) => {
      expect(inlineIsPrivateOrLoopback(ip)).toBe(true);
      expect(serverIsPrivateOrLoopback(ip)).toBe(true);
    });
  });

  describe('both classify as PUBLIC', () => {
    it.each([
      ['203.0.113.7', 'TEST-NET-3 (the synthetic probe client)'],
      ['8.8.8.8', 'public IPv4'],
      ['1.1.1.1', 'public IPv4'],
      ['172.15.255.255', 'just below RFC1918 172.16/12'],
      ['172.32.0.1', 'just above RFC1918 172.16/12'],
      ['11.0.0.1', 'just above RFC1918 10/8'],
      ['192.169.0.1', 'just above RFC1918 192.168/16'],
      ['2001:db8::1', 'IPv6 documentation block'],
      ['2606:4700:4700::1111', 'public IPv6 (Cloudflare DNS)'],
      ['fb00::1', 'just below IPv6 unique-local fc/7'],
    ])('%s (%s)', (ip) => {
      expect(inlineIsPrivateOrLoopback(ip)).toBe(false);
      expect(serverIsPrivateOrLoopback(ip)).toBe(false);
    });
  });

  // Pins the precise behavior the CIDR-aware rewrite (task #502)
  // gives us over the old string-prefix matcher. The previous
  // version used `['127.', '10.', '192.168.', '169.254.', '::1',
  // 'fe80:', 'fc', 'fd']` and a `172.\d+.` regex — so any string
  // starting with 'fc' or 'fd' (e.g. a misbehaving upstream emitting
  // "fcat" / "fdoozle") would have been silently classified as an
  // IPv6 unique-local address. Worse, an address like
  // '127garbage' would have flowed through the `startsWith('127.')`
  // branch as IPv4 loopback. Both would have either paged the
  // on-call about a non-existent regression OR (worse) classified a
  // real client IP as private and obscured a real misconfiguration.
  // The new implementation parses with ipaddr.js and fails closed
  // on unparseable input, so we get `true` for the right reason
  // (parse failure) instead of accidentally pattern-matching a
  // legitimate range.
  describe('CIDR-aware precision (would have been wrong under the old prefix matcher)', () => {
    it.each([
      ['fcat', "starts with 'fc' but isn't an IPv6 ULA"],
      ['fdoozle', "starts with 'fd' but isn't an IPv6 ULA"],
      ['fe80x', "starts with 'fe80' but isn't a valid IPv6"],
      ['127garbage', "starts with '127' but isn't a valid IPv4"],
      ['10.x.y.z', "starts with '10.' but isn't a valid IPv4"],
      ['not-an-ip', 'pure garbage'],
    ])('fail-closed on unparseable %s (%s) → true', (ip) => {
      expect(inlineIsPrivateOrLoopback(ip)).toBe(true);
      expect(serverIsPrivateOrLoopback(ip)).toBe(true);
    });

    it('unwraps IPv4-mapped IPv6 to catch tunneled loopback', () => {
      expect(inlineIsPrivateOrLoopback('::ffff:127.0.0.1')).toBe(true);
      expect(serverIsPrivateOrLoopback('::ffff:127.0.0.1')).toBe(true);
    });

    it('unwraps IPv4-mapped IPv6 to catch tunneled RFC1918', () => {
      expect(inlineIsPrivateOrLoopback('::ffff:10.0.0.1')).toBe(true);
      expect(serverIsPrivateOrLoopback('::ffff:10.0.0.1')).toBe(true);
    });

    it('unwraps IPv4-mapped IPv6 and lets a public address through', () => {
      expect(inlineIsPrivateOrLoopback('::ffff:8.8.8.8')).toBe(false);
      expect(serverIsPrivateOrLoopback('::ffff:8.8.8.8')).toBe(false);
    });

    it('rejects 0.0.0.0 (unspecified) — never a real client', () => {
      expect(inlineIsPrivateOrLoopback('0.0.0.0')).toBe(true);
      expect(serverIsPrivateOrLoopback('0.0.0.0')).toBe(true);
    });

    it('rejects :: (IPv6 unspecified) — never a real client', () => {
      expect(inlineIsPrivateOrLoopback('::')).toBe(true);
      expect(serverIsPrivateOrLoopback('::')).toBe(true);
    });
  });
});
