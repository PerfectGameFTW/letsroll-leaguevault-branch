/**
 * Pins the IPv6 /64 collapsing in the change-password limiter's
 * keyGenerator (task #430).
 *
 * The original `keyGenerator` returned `ip:${req.ip}` directly, which
 * gave every IPv6 address its own bucket — an attacker on a /64 could
 * rotate addresses to dodge the 10/15min cap. `ipKeyGenerator` from
 * express-rate-limit collapses any IPv6 address down to its /64
 * prefix, so all addresses inside one /64 share a bucket.
 *
 * This test reaches into the exported keyGenerator function directly
 * rather than booting the limiter, so it doesn't need a live server,
 * the Postgres store, or trust-proxy headers — it just verifies the
 * keying contract that the bucket lookup depends on.
 */
import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { changePasswordKeyGenerator } from '../../server/routes/account';

function makeReq(overrides: { ip?: string; userId?: number } = {}): Request {
  return {
    ip: overrides.ip,
    user: overrides.userId !== undefined ? { id: overrides.userId } : undefined,
  } as unknown as Request;
}

describe('changePasswordKeyGenerator (task #430 IPv6 bypass fix)', () => {
  it('keys on userId when the request is authenticated', () => {
    const key = changePasswordKeyGenerator(
      makeReq({ ip: '203.0.113.5', userId: 42 }),
    );
    expect(key).toBe('u:42');
  });

  it('keys on userId regardless of the source IP', () => {
    // Two different source IPs for the same user must hit the same bucket.
    const key1 = changePasswordKeyGenerator(
      makeReq({ ip: '203.0.113.5', userId: 42 }),
    );
    const key2 = changePasswordKeyGenerator(
      makeReq({ ip: '198.51.100.9', userId: 42 }),
    );
    expect(key1).toBe(key2);
  });

  it('falls through to the IP key when the user is not yet authenticated', () => {
    const key = changePasswordKeyGenerator(makeReq({ ip: '203.0.113.5' }));
    expect(key.startsWith('ip:')).toBe(true);
  });

  it('falls through to a stable "unknown" placeholder when req.ip is missing', () => {
    const key = changePasswordKeyGenerator(makeReq({}));
    expect(key.startsWith('ip:')).toBe(true);
    // Two missing-IP requests must collapse to the same bucket — the
    // alternative (a random placeholder) would silently turn the
    // limiter off for callers without a parseable IP.
    const key2 = changePasswordKeyGenerator(makeReq({}));
    expect(key).toBe(key2);
  });

  it('collapses two IPv6 addresses in the same /64 to a single bucket', () => {
    // Both addresses live in 2001:db8:1234:5678::/64.
    const key1 = changePasswordKeyGenerator(
      makeReq({ ip: '2001:db8:1234:5678::1' }),
    );
    const key2 = changePasswordKeyGenerator(
      makeReq({ ip: '2001:db8:1234:5678:dead:beef:cafe:1' }),
    );
    expect(key1).toBe(key2);
  });

  it('keeps two IPv6 addresses in different /64s in separate buckets', () => {
    const key1 = changePasswordKeyGenerator(
      makeReq({ ip: '2001:db8:1234:5678::1' }),
    );
    const key2 = changePasswordKeyGenerator(
      makeReq({ ip: '2001:db8:1234:9999::1' }),
    );
    expect(key1).not.toBe(key2);
  });

  it('keeps two distinct IPv4 addresses in separate buckets', () => {
    const key1 = changePasswordKeyGenerator(makeReq({ ip: '203.0.113.5' }));
    const key2 = changePasswordKeyGenerator(makeReq({ ip: '198.51.100.9' }));
    expect(key1).not.toBe(key2);
  });
});
