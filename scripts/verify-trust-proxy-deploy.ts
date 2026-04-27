/**
 * Post-deploy verification probe for the trust-proxy contract (task #379).
 *
 * Pairs with the boot-time guard at `server/lib/trust-proxy-check.ts`
 * and the system-admin debug endpoint
 * `GET /api/system-admin/trust-proxy-status`. The boot guard catches
 * code-side misconfiguration on startup; this probe catches the case
 * where a config change at the proxy layer (Replit edge, custom
 * domain, future CDN) silently re-introduces the bug without any code
 * change. If `req.ip` collapses to the proxy's loopback / private
 * address, every per-IP rate limiter (notably the 5 req / 15 min
 * setupAdminLimiter) becomes a global ceiling for the entire internet.
 *
 * What this script does
 * ---------------------
 *   1. Calls the debug endpoint on the deployed app, authenticating
 *      either via an `X-Probe-Token` header (preferred — long-lived
 *      shared secret, no rotation) or a `Cookie` header carrying a
 *      system_admin session (legacy — sessions expire after ~24h).
 *   2. Asserts HTTP 200 and the response shape is valid JSON.
 *   3. Asserts `synthetic.ok === true` — the boot probe still passes
 *      (i.e. nothing about the deployed Express config has drifted
 *      since last boot).
 *   4. Asserts `live.resolvedIp` is NOT a loopback / private address.
 *      That's the post-deploy reality check: a real external request
 *      from this script's caller IP must come back as a routable
 *      public address.
 *   5. If `EXPECTED_RESOLVED_IP` is set, asserts an exact match. Use
 *      this from a CI job that knows its egress IP (e.g. a self-hosted
 *      runner with a static IP).
 *
 * Required env vars
 * -----------------
 *   BASE_URL         e.g. https://app.example.com
 *
 *   AND exactly ONE of:
 *     PROBE_TOKEN    long-lived shared secret matching the server's
 *                    `TRUST_PROXY_PROBE_TOKEN` env var. Sent as the
 *                    `X-Probe-Token` header. Must be at least 32
 *                    chars (the server enforces the same minimum).
 *                    PREFERRED — never expires, no rotation needed.
 *     ADMIN_COOKIE   full Cookie header value for a system_admin
 *                    session, e.g. "connect.sid=s%3A...". LEGACY —
 *                    expires with the session (~24h by default).
 *                    Only used when PROBE_TOKEN is unset.
 *
 * Optional env vars
 * -----------------
 *   EXPECTED_RESOLVED_IP   the public egress IP of this caller; if
 *                          set, the script asserts an exact match
 *                          against `live.resolvedIp`.
 *   PROBE_TIMEOUT_MS       default 10000.
 *
 * Exit codes
 * ----------
 *   0  all assertions passed
 *   1  any assertion failed (loud message printed to stderr)
 *   2  configuration error (missing required env var, bad URL, etc.)
 *
 * Wire it into your deploy pipeline as the last step after the new
 * version is healthy, so a misconfigured proxy fails the deploy
 * loudly instead of silently degrading the rate-limit ceiling.
 *
 * Today this script is invoked by:
 *   - `.github/workflows/post-deploy-trust-proxy.yml` — runs every
 *     30 minutes against the live deploy and on-demand via
 *     `workflow_dispatch` after a release. Reads its env from the
 *     `DEPLOY_BASE_URL`, `DEPLOY_PROBE_TOKEN` (preferred) or
 *     `DEPLOY_ADMIN_COOKIE` (legacy), and (optional)
 *     `DEPLOY_EXPECTED_RESOLVED_IP` repo secrets.
 *
 * When adding a new caller (e.g. a Replit-side post-deploy hook),
 * add it to the list above so future maintainers can find every
 * place this contract is enforced.
 */

interface ProbeResponse {
  success: boolean;
  data?: {
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
  };
  error?: { message?: string; code?: string };
}

// Mirrors `isPrivateOrLoopback` in `server/lib/trust-proxy-check.ts`.
// Kept inline so the script has zero compile-time deps on the server
// bundle — it can run from a minimal CI image with just `tsx` (or
// even be transpiled and run as plain node) without pulling Express.
//
// We DO depend on `ipaddr.js` (already a runtime dep of the server,
// so `npm ci` in the CI workflow installs it for free; ~30KB, no
// transitive deps). That gives us the same CIDR-aware classifier as
// the server-side helper without re-implementing range arithmetic
// here. See the rationale in `server/lib/trust-proxy-check.ts` —
// the previous string-prefix list (`['fc', 'fd', ...]`) would have
// falsely matched non-IP strings like "fcat" / "fdoozle" emitted by
// a misbehaving upstream and either paged the on-call about a
// non-existent regression OR (worse) classified a real client IP as
// private and obscured a real misconfiguration.
import ipaddr from 'ipaddr.js';

// IPv4 ranges that, if `live.resolvedIp` ever resolves to one in
// production, mean the proxy is eating the X-Forwarded-For: loopback
// (127/8), RFC1918 private (10/8, 172.16/12, 192.168/16), link-local
// (169.254/16), and `unspecified` (0.0.0.0). Kept identical to the
// server's `IPV4_BAD_RANGES` so the boot guard and the post-deploy
// probe agree on what counts as a "real" client address.
const IPV4_BAD_RANGES = new Set<string>([
  'loopback',
  'private',
  'linkLocal',
  'unspecified',
]);

// IPv6 equivalents: loopback (::1), unique-local (fc00::/7), link-local
// (fe80::/10), and unspecified (::). `ipv4Mapped` is intentionally NOT
// in this set — we unwrap those addresses below and re-check the
// embedded IPv4 instead, so a `::ffff:127.0.0.1` is correctly rejected
// as IPv4 loopback rather than allowed through as a "non-private" IPv6
// address.
const IPV6_BAD_RANGES = new Set<string>([
  'loopback',
  'uniqueLocal',
  'linkLocal',
  'unspecified',
]);

// Exported for the regression test at
// `tests/unit/verify-trust-proxy-deploy.test.ts`, which pins this
// inline copy against `server/lib/trust-proxy-check.ts`'s CIDR-aware
// classifier on a fixed table of IPs. If the server tightens (see
// task #380) and the inline copy here drifts, that test fails
// loudly instead of letting the post-deploy probe silently disagree
// with the boot guard about what counts as a real client address.
//
// Fail-closed contract: empty / `unknown` / unparseable inputs all
// return `true`. Better to surface a misconfigured proxy loudly than
// to silently classify garbage as a real client IP.
export function isPrivateOrLoopback(ip: string): boolean {
  if (!ip) return true;
  const lower = ip.toLowerCase();
  // Some proxy-addr code paths emit the literal "unknown" instead of
  // a parseable address; treat it as private (fail-closed). Mirrors
  // the server-side helper exactly.
  if (lower === 'unknown') return true;
  if (!ipaddr.isValid(ip)) return true;
  let addr = ipaddr.parse(ip);
  // Unwrap IPv4-mapped IPv6 (::ffff:1.2.3.4) so a tunneled loopback
  // or RFC1918 address still gets caught by the IPv4 ruleset rather
  // than being waved through as "just an IPv6 address".
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      addr = v6.toIPv4Address();
    }
  }
  const range = addr.range();
  if (addr.kind() === 'ipv4') {
    return IPV4_BAD_RANGES.has(range);
  }
  return IPV6_BAD_RANGES.has(range);
}

function fail(msg: string, exitCode = 1): never {
  console.error(`[verify-trust-proxy-deploy] FAIL — ${msg}`);
  process.exit(exitCode);
}

function info(msg: string): void {
  console.log(`[verify-trust-proxy-deploy] ${msg}`);
}

export async function runVerifier(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const baseUrl = env.BASE_URL?.trim();
  const probeToken = env.PROBE_TOKEN?.trim();
  const adminCookie = env.ADMIN_COOKIE?.trim();
  const expectedResolvedIp = env.EXPECTED_RESOLVED_IP?.trim() || null;
  const timeoutMs = (() => {
    const raw = env.PROBE_TIMEOUT_MS?.trim();
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 10_000;
  })();

  if (!baseUrl) fail('BASE_URL is required (e.g. https://app.example.com)', 2);
  if (!probeToken && !adminCookie) {
    fail(
      'either PROBE_TOKEN (preferred, no rotation) or ADMIN_COOKIE (legacy, ~24h) is required',
      2,
    );
  }
  // The server requires >=32 chars for the probe token. Catch a short
  // value here so the operator gets a clear configuration error
  // instead of an "Invalid probe token" 401 from the server.
  if (probeToken && probeToken.length < 32) {
    fail('PROBE_TOKEN must be at least 32 characters (matches server-side minimum)', 2);
  }

  let url: URL;
  try {
    url = new URL('/api/system-admin/trust-proxy-status', baseUrl);
  } catch {
    fail(`BASE_URL is not a valid URL: ${baseUrl}`, 2);
  }

  // Auth header selection — token wins when both are present so an
  // operator who set up the token can leave a stale cookie around
  // without it being silently used. Logged so a failing run makes
  // the auth mode obvious in CI output.
  //
  // The earlier branch already exits via `fail()` (which is `never`) if
  // neither credential is set, so by here at least one is present;
  // pick the one we actually have without leaning on `!`.
  const authHeaders: Record<string, string> = {};
  let authMode: 'token' | 'cookie';
  if (probeToken) {
    authHeaders['X-Probe-Token'] = probeToken;
    authMode = 'token';
  } else if (adminCookie) {
    authHeaders.Cookie = adminCookie;
    authMode = 'cookie';
  } else {
    // Defensive — the earlier check should have already fail()ed.
    fail('no credentials available (unreachable)', 2);
  }

  info(`Probing ${url.toString()} (auth=${authMode})`);

  // Wrapping the fetch + status/JSON parse in helpers lets each step
  // narrow `Response` and `ProbeResponse` through the function's
  // return type, instead of leaving us with `let res: Response` whose
  // first assignment is inside a try/catch (which TS cannot narrow,
  // forcing `res!` everywhere downstream).
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const fetchOrFail = async (): Promise<Response> => {
    try {
      return await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...authHeaders,
        },
        signal: ac.signal,
        redirect: 'manual',
      });
    } catch (err) {
      fail(`request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  };
  const res = await fetchOrFail();

  if (res.status !== 200) {
    const body = await res.text().catch(() => '<unreadable body>');
    fail(`HTTP ${res.status} from probe endpoint. Body: ${body.slice(0, 500)}`);
  }

  const parseJsonOrFail = async (): Promise<ProbeResponse> => {
    try {
      return (await res.json()) as ProbeResponse;
    } catch (err) {
      fail(`response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const body = await parseJsonOrFail();

  if (!body.success || !body.data) {
    fail(`response not successful: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const data = body.data;

  // Assertion 1: the synthetic probe (same one the boot guard uses)
  // still reports green. If this regresses, the deployed Express
  // config has drifted in a way the boot guard would have caught — a
  // strong signal something replaced the running process without
  // rebooting through our entrypoint.
  if (!data.synthetic.ok) {
    fail(
      `synthetic probe failed: resolvedIp=${data.synthetic.resolvedIp} ` +
        `reason=${data.synthetic.reason ?? '<none>'} ` +
        `trustProxySetting=${JSON.stringify(data.config.trustProxySetting)}`,
    );
  }

  // Assertion 2: the live request resolved to a routable address. This
  // is the post-deploy reality check the boot guard cannot make on
  // its own (it only synthesizes a request).
  const liveIp = data.live.resolvedIp ?? '';
  if (isPrivateOrLoopback(liveIp)) {
    fail(
      `live req.ip resolved to a loopback/private address (${liveIp}). ` +
        `The proxy is not honoring X-Forwarded-For for real external requests; ` +
        `per-IP rate limiters will key on the proxy's address and brute-force ` +
        `protection collapses into a global cap. ` +
        `socketRemoteAddress=${data.live.socketRemoteAddress ?? '<null>'} ` +
        `xForwardedFor=${data.live.xForwardedFor ?? '<null>'} ` +
        `trustProxySetting=${JSON.stringify(data.config.trustProxySetting)}`,
    );
  }

  // Assertion 3 (optional): exact-match against a known caller IP.
  if (expectedResolvedIp && liveIp !== expectedResolvedIp) {
    fail(
      `live req.ip (${liveIp}) does not match EXPECTED_RESOLVED_IP (${expectedResolvedIp}). ` +
        `Either the proxy is rewriting XFF, the trust-proxy hop count is off, ` +
        `or the egress IP changed. xForwardedFor=${data.live.xForwardedFor ?? '<null>'}`,
    );
  }

  info(
    `OK — live.resolvedIp=${liveIp} synthetic.ok=true ` +
      `trustProxySetting=${JSON.stringify(data.config.trustProxySetting)}`,
  );
}

// Only run when invoked directly (so the test can import `runVerifier`
// without triggering the side effect).
const isMain = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    // import.meta.url is the file URL of this module under tsx/ESM.
    const here = new URL(import.meta.url).pathname;
    return argv1 === here || argv1.endsWith('/verify-trust-proxy-deploy.ts');
  } catch {
    return false;
  }
})();

if (isMain) {
  runVerifier().catch((err) => {
    console.error(`[verify-trust-proxy-deploy] unexpected error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
}
