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
  exitSpy = vi
    .spyOn(process, 'exit')
    .mockImplementation((code?: number | string | null) => {
      throw new Error(`__EXIT__:${code ?? 0}`);
    });
  fetchSpy = vi.spyOn(globalThis, 'fetch');
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

describe('runVerifier — representative tests (Consolidated)', () => {
  it('1. GREEN-PATH SUCCESS: returns without throwing when every assertion passes', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ success: true, data: happyData() }));
    await expect(runVerifier(happyEnv())).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.flat().join('\n')).toMatch(/OK — live\.resolvedIp=203\.0\.113\.7/);
  });

  it('2. ENV VALIDATION FAILURE: exits 2 when BASE_URL is missing', async () => {
    await expect(runVerifier({ ADMIN_COOKIE: 'x' })).rejects.toThrow('__EXIT__:2');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/BASE_URL is required/);
  });

  it('3. PERSISTENT 5XX EXHAUSTING RETRIES: exits 1 with "edge vs handler" labeling', async () => {
    // Edge variant (non-JSON 5xx)
    fetchSpy.mockResolvedValue(new Response('Error', { status: 500 }));
    await expect(
      runVerifier(happyEnv({ PROBE_MAX_ATTEMPTS: '1', PROBE_RETRY_BASE_MS: '0' })),
    ).rejects.toThrow('__EXIT__:1');
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/edge returned HTTP 500/);

    // Handler variant (JSON 5xx)
    fetchSpy.mockResolvedValue(jsonResponse({ success: false, error: { code: 'SERVER_ERROR' } }, 500));
    await expect(
      runVerifier(happyEnv({ PROBE_MAX_ATTEMPTS: '1', PROBE_RETRY_BASE_MS: '0' })),
    ).rejects.toThrow('__EXIT__:1');
    expect(errorSpy.mock.calls[1]?.[0]).toMatch(/handler returned HTTP 500/);
  });

  it('4. 401 INVALID_PROBE_TOKEN NO-RETRY: exits 1 immediately', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ success: false, error: { code: 'INVALID_PROBE_TOKEN' } }, 401),
    );
    await expect(
      runVerifier(happyEnv({ PROBE_MAX_ATTEMPTS: '4', PROBE_RETRY_BASE_MS: '0' })),
    ).rejects.toThrow('__EXIT__:1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('5. EXPECTED_RESOLVED_IP MISMATCH: exits 1 when IPs do not match', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ success: true, data: happyData({ live: { resolvedIp: '1.1.1.1', socketRemoteAddress: null, xForwardedFor: null, protocol: 'https', hostname: 'app.example.com' } }) }));
    await expect(
      runVerifier(happyEnv({ EXPECTED_RESOLVED_IP: '2.2.2.2', PROBE_MAX_ATTEMPTS: '1' })),
    ).rejects.toThrow('__EXIT__:1');
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/does not match EXPECTED_RESOLVED_IP/);
  });

  it('6. IPv4-MAPPED IPv6 UNWRAP: correctly classifies tunneled loopback', () => {
    // Representative IPv4-mapped IPv6 check
    expect(inlineIsPrivateOrLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(serverIsPrivateOrLoopback('::ffff:127.0.0.1')).toBe(true);
    
    // One public assertion for classifier balance
    expect(inlineIsPrivateOrLoopback('8.8.8.8')).toBe(false);
    expect(serverIsPrivateOrLoopback('8.8.8.8')).toBe(false);
  });
});
