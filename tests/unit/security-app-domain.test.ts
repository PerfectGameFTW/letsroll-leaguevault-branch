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

interface DevEnv {
  REPLIT_DOMAINS?: string;
  REPL_SLUG?: string;
  REPL_OWNER?: string;
}

function mockDevConfig(appDomain: string, devEnv: DevEnv = {}): void {
  vi.doMock('../../server/config', () => ({
    env: {
      APP_DOMAIN: appDomain,
      SENDGRID_API_KEY: undefined,
      REPLIT_DOMAINS: devEnv.REPLIT_DOMAINS,
      REPL_SLUG: devEnv.REPL_SLUG,
      REPL_OWNER: devEnv.REPL_OWNER,
    },
    isDev: true,
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

/**
 * Pins the dev-only branches of `getAllowedOrigins()` so a future
 * refactor cannot silently drop REPLIT_DOMAINS / REPL_SLUG+REPL_OWNER /
 * localhost variants and only break inside the Replit preview iframe
 * (where it is hardest to notice). APP_DOMAIN production coverage is
 * already pinned by the suites above; these tests cover the dev-only
 * counterparts that task #334 left unprotected.
 */
describe('isAllowedOrigin in dev mode', () => {
  it('allow-lists every host listed in REPLIT_DOMAINS', async () => {
    mockDevConfig('staging.example', {
      REPLIT_DOMAINS:
        'abc-123.spock.repl.co,xyz-456.kirk.repl.co',
    });
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('https://abc-123.spock.repl.co')).toBe(true);
    expect(isAllowedOrigin('https://xyz-456.kirk.repl.co')).toBe(true);
    // Hosts not in the list — and not subdomains of APP_DOMAIN — stay
    // rejected even in dev.
    expect(isAllowedOrigin('https://attacker.repl.co')).toBe(false);
  });

  it('allow-lists the legacy ${REPL_SLUG}.${REPL_OWNER}.repl.co host', async () => {
    mockDevConfig('staging.example', {
      REPL_SLUG: 'leaguevault',
      REPL_OWNER: 'taylor',
    });
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('https://leaguevault.taylor.repl.co')).toBe(true);
  });

  it.each([
    ['REPL_SLUG only', { REPL_SLUG: 'leaguevault' }],
    ['REPL_OWNER only', { REPL_OWNER: 'taylor' }],
  ])(
    'does not synthesize a repl.co origin when only %s is set',
    async (_label, devEnv) => {
      // Guards the `if (REPL_SLUG && REPL_OWNER)` short-circuit — without
      // it a missing var would push `https://undefined.undefined.repl.co`.
      // Both asymmetric cases are covered so a regression that broke
      // either side of the AND would surface.
      mockDevConfig('staging.example', devEnv);
      const { isAllowedOrigin } = await import('../../server/middleware/security');
      expect(isAllowedOrigin('https://undefined.undefined.repl.co')).toBe(false);
      expect(isAllowedOrigin('https://leaguevault.undefined.repl.co')).toBe(false);
      expect(isAllowedOrigin('https://undefined.taylor.repl.co')).toBe(false);
    },
  );

  it.each([
    'http://localhost:5000',
    'http://localhost:5173',
    'http://127.0.0.1:5000',
    'http://127.0.0.1:5173',
  ])('allow-lists the dev loopback origin %s', async (origin) => {
    mockDevConfig('staging.example');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin(origin)).toBe(true);
  });

  it('does not allow-list dev loopback origins in production', async () => {
    // mockConfig sets isDev: false. The dev branch is gated on isDev,
    // so loopback origins must be rejected when the server thinks it's
    // running in production — even on the same machine.
    mockConfig('staging.example');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('http://localhost:5000')).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(false);
  });

  it('still rejects http:// on a non-loopback host even in dev', async () => {
    mockDevConfig('staging.example');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('http://acme.staging.example')).toBe(false);
    expect(isAllowedOrigin('http://attacker.example')).toBe(false);
  });
});

/**
 * Pins that the REPLIT_DOMAINS / REPL_SLUG+OWNER allow-listing is
 * truly DEV-ONLY. If a refactor moves any of those pushes outside the
 * `if (isDev)` block, a production deploy that still has the env vars
 * set (very common on Replit) would silently broaden the prod CORS
 * allow-list. These tests use the prod-mode mockConfig directly but
 * inject the dev env vars through a custom doMock so we can assert the
 * gate, not just the absence of the vars.
 */
describe('isAllowedOrigin gates dev origins on isDev=false', () => {
  function mockProdWithDevEnv(appDomain: string, devEnv: DevEnv): void {
    vi.doMock('../../server/config', () => ({
      env: {
        APP_DOMAIN: appDomain,
        SENDGRID_API_KEY: undefined,
        REPLIT_DOMAINS: devEnv.REPLIT_DOMAINS,
        REPL_SLUG: devEnv.REPL_SLUG,
        REPL_OWNER: devEnv.REPL_OWNER,
      },
      isDev: false,
    }));
  }

  it('rejects REPLIT_DOMAINS hosts in production even when the env var is populated', async () => {
    mockProdWithDevEnv('staging.example', {
      REPLIT_DOMAINS: 'abc-123.spock.repl.co,xyz-456.kirk.repl.co',
    });
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('https://abc-123.spock.repl.co')).toBe(false);
    expect(isAllowedOrigin('https://xyz-456.kirk.repl.co')).toBe(false);
  });

  it('rejects ${REPL_SLUG}.${REPL_OWNER}.repl.co in production even when both env vars are set', async () => {
    mockProdWithDevEnv('staging.example', {
      REPL_SLUG: 'leaguevault',
      REPL_OWNER: 'taylor',
    });
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('https://leaguevault.taylor.repl.co')).toBe(false);
  });
});

/**
 * Capacitor and Ionic mobile shells run inside a WebView with a
 * non-https custom-scheme origin (capacitor://localhost,
 * ionic://localhost). Those origins must stay allowed regardless of
 * APP_DOMAIN or dev/prod mode, otherwise the mobile app's API calls
 * fail at the CORS layer with no obvious server-side signal.
 */
describe('isAllowedOrigin allows mobile-shell origins regardless of APP_DOMAIN', () => {
  it.each([
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
  ])('allows %s in production', async (origin) => {
    mockConfig('leaguevault.app');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin(origin)).toBe(true);
  });

  it.each([
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
  ])('allows %s when APP_DOMAIN is a custom value', async (origin) => {
    mockConfig('staging.example');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin(origin)).toBe(true);
  });

  it('allows capacitor:// and ionic:// in dev mode too', async () => {
    mockDevConfig('staging.example');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('capacitor://localhost')).toBe(true);
    expect(isAllowedOrigin('ionic://localhost')).toBe(true);
  });

  it('does not allow look-alike custom-scheme origins on other hosts', async () => {
    // Belt-and-braces: the allow check is a literal-string match for
    // the two known mobile-shell origins, so any other capacitor://
    // or ionic:// host must still be rejected.
    mockConfig('leaguevault.app');
    const { isAllowedOrigin } = await import('../../server/middleware/security');
    expect(isAllowedOrigin('capacitor://attacker.example')).toBe(false);
    expect(isAllowedOrigin('ionic://attacker.example')).toBe(false);
  });
});
