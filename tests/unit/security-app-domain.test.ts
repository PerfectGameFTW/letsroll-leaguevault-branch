/**
 * Pins that the CORS allow-list and Helmet `frame-ancestors` directive in
 * `server/middleware/security.ts` honor `config.APP_DOMAIN` at module
 * load. A future refactor must not re-introduce the `leaguevault.app`
 * literal — these tests fail loudly if it does.
 *
 * Each test resets the module cache and mocks `server/config` with a
 * custom `env.APP_DOMAIN` so allowlist generation runs against the
 * mocked value (allowed origins are computed once at module load).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

function mockConfig(appDomain: string): void {
  vi.doMock('../../server/config', () => ({
    env: {
      APP_DOMAIN: appDomain,
      SENDGRID_API_KEY: undefined,
      REPLIT_DOMAINS: undefined,
      REPL_SLUG: undefined,
      REPL_OWNER: undefined,
    },
    isDev: false,
  }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../../server/config');
});

describe('isAllowedOrigin honors APP_DOMAIN', () => {
  it('allows the bare APP_DOMAIN host over https', async () => {
    mockConfig('staging.example');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('https://staging.example')).toBe(true);
  });

  it('allows any subdomain of APP_DOMAIN over https', async () => {
    mockConfig('staging.example');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('https://acme.staging.example')).toBe(true);
    expect(isAllowedOrigin('https://perfect-game.staging.example')).toBe(true);
  });

  it('rejects the legacy leaguevault.app suffix when APP_DOMAIN is different', async () => {
    mockConfig('staging.example');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('https://acme.leaguevault.app')).toBe(false);
    expect(isAllowedOrigin('https://leaguevault.app')).toBe(false);
  });

  it('rejects http:// even on a matching APP_DOMAIN suffix', async () => {
    mockConfig('staging.example');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('http://acme.staging.example')).toBe(false);
  });

  it('still allows leaguevault.app subdomains by default (production)', async () => {
    mockConfig('leaguevault.app');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('https://leaguevault.app')).toBe(true);
    expect(isAllowedOrigin('https://acme.leaguevault.app')).toBe(true);
  });
});

/**
 * Runs the helmet-configured `securityHeaders` middleware against a fake
 * request/response and returns the `Content-Security-Policy` header it
 * sets. Helmet writes the header synchronously via `res.setHeader`.
 */
async function runSecurityHeadersAndGetCsp(): Promise<string> {
  const { securityHeaders } = await import('../../server/middleware/security');
  const headers: Record<string, string> = {};
  const req = { method: 'GET', headers: {} } as unknown as Request;
  const res = {
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name.toLowerCase()] = String(value);
      return this;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    removeHeader(name: string) {
      delete headers[name.toLowerCase()];
    },
    end() {},
  } as unknown as Response;
  await new Promise<void>((resolve, reject) => {
    securityHeaders(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
  });
  const csp = headers['content-security-policy'];
  if (!csp) throw new Error('Helmet did not set Content-Security-Policy');
  return csp;
}

describe('CSP frame-ancestors honors APP_DOMAIN', () => {
  it('emits frame-ancestors built from APP_DOMAIN, not the leaguevault.app literal', async () => {
    mockConfig('staging.example');
    const csp = await runSecurityHeadersAndGetCsp();

    const directive = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('frame-ancestors'));
    expect(directive).toBeDefined();
    expect(directive).toContain("'self'");
    expect(directive).toContain('https://staging.example');
    expect(directive).toContain('https://*.staging.example');
    expect(directive).not.toContain('leaguevault.app');
  });

  it('uses leaguevault.app in frame-ancestors when APP_DOMAIN is the default', async () => {
    mockConfig('leaguevault.app');
    const csp = await runSecurityHeadersAndGetCsp();

    const directive = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('frame-ancestors'));
    expect(directive).toBeDefined();
    expect(directive).toContain('https://leaguevault.app');
    expect(directive).toContain('https://*.leaguevault.app');
  });
});
