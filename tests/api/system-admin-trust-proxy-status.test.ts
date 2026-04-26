/**
 * GET /api/system-admin/trust-proxy-status (task #379)
 * ------------------------------------------------------------------
 * The endpoint exposes the live `req.ip` Express resolved + the
 * configured trust-proxy setting + the same synthetic probe the boot
 * guard uses, so a post-deploy smoke check can assert end-to-end that
 * a config change at the proxy layer (Replit edge, custom domain,
 * future CDN) hasn't silently re-introduced the misconfiguration that
 * collapses every per-IP rate limit into a global ceiling.
 *
 * This test pins:
 *   1. Auth contract: 401 unauthenticated, 403 non-system-admin,
 *      200 for system_admin.
 *   2. Response shape: `live`, `config`, `synthetic` keys present and
 *      typed correctly. Crucially the synthetic block reports `ok:
 *      true` because the dev server itself sets `trust proxy = 1`,
 *      mirroring production.
 *
 * Note on XFF assertions: we deliberately do NOT pin "the request's
 * X-Forwarded-For header round-trips byte-for-byte" here. In the
 * Replit test env every request reaches the dev server through an
 * edge proxy that rewrites/replaces XFF, so the value the endpoint
 * sees never matches what we set client-side. The truncation logic
 * (256-char cap + ellipsis marker) is small enough to read by
 * inspection and is exercised end-to-end by the post-deploy probe
 * (`scripts/verify-trust-proxy-deploy.ts`) when run against a real
 * deployment.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  login,
  apiGet,
  type AuthSession,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

interface StatusBody {
  live: {
    resolvedIp: string | null;
    socketRemoteAddress: string | null;
    xForwardedFor: string | null;
    protocol: string;
    hostname: string;
  };
  config: {
    trustProxySetting: unknown;
  };
  synthetic: {
    ok: boolean;
    resolvedIp: string;
    reason: string | null;
  };
}

describe('GET /api/system-admin/trust-proxy-status', () => {
  let admin: AuthSession;

  beforeAll(async () => {
    admin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
  });

  it('rejects unauthenticated callers with 401', async () => {
    const { status } = await apiGet('/api/system-admin/trust-proxy-status');
    expect(status).toBe(401);
  });

  it('rejects non-system-admin callers with 403', async () => {
    const orgUser = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const { status } = await apiGet('/api/system-admin/trust-proxy-status', orgUser);
    expect(status).toBe(403);
  });

  it('returns the live + config + synthetic shape for a system_admin', async () => {
    const { status, data } = await apiGet<StatusBody>(
      '/api/system-admin/trust-proxy-status',
      admin,
    );
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    const body = data.data;
    expect(body).toBeDefined();

    // live block: resolvedIp may be 127.0.0.1 in test (we connect via
    // localhost), but the field must be present and a string|null.
    expect(body!.live).toBeDefined();
    expect(typeof body!.live.protocol).toBe('string');
    expect(typeof body!.live.hostname).toBe('string');
    expect(
      body!.live.resolvedIp === null || typeof body!.live.resolvedIp === 'string',
    ).toBe(true);
    expect(
      body!.live.socketRemoteAddress === null
        || typeof body!.live.socketRemoteAddress === 'string',
    ).toBe(true);

    // config block: dev server calls `app.set('trust proxy', 1)` in
    // setupAuth, so the setting is the number 1 (NOT a function — we
    // deliberately project '[function]' if it ever becomes one).
    expect(body!.config).toBeDefined();
    expect(body!.config.trustProxySetting).toBe(1);

    // synthetic block: same probe as the boot guard. Trust proxy = 1
    // means the synthetic XFF (`203.0.113.7`) must resolve to that
    // exact address; if it doesn't, the boot guard would have thrown.
    expect(body!.synthetic.ok).toBe(true);
    expect(body!.synthetic.resolvedIp).toBe('203.0.113.7');
    expect(body!.synthetic.reason).toBeNull();

    // The endpoint always echoes the live XFF header (or null). We
    // assert only the *type contract* here — the value itself is
    // whatever the upstream edge proxy decided to put on the wire,
    // which is environment-specific (see file header note).
    expect(
      body!.live.xForwardedFor === null
        || typeof body!.live.xForwardedFor === 'string',
    ).toBe(true);
  });
});
