import type { Express } from "express";
import proxyAddr from "proxy-addr";

// Why this exists (task #326):
//
// `app.set('trust proxy', N)` does double duty: it gates how many proxy
// hops Express will believe in `req.ip`/`req.protocol`, and per-IP rate
// limiters (most importantly `setupAdminLimiter` at 5 req / 15 min)
// key off `req.ip`. If a future deploy moves us behind a different
// proxy topology and trust-proxy is misconfigured, every real request
// will resolve to the proxy's loopback/private address and the brute
// force ceiling silently collapses into a 5 req / 15 min cap for the
// *entire internet*. The header-shape defenses still hold (#289), but
// the rate ceiling is what we lose.
//
// This module synthesizes a request with a realistic X-Forwarded-For
// chain and asks Express's *exact* proxy-addr resolver what `req.ip`
// would resolve to. If the answer is the loopback or otherwise
// non-routable, trust-proxy is misconfigured for the deployed topology.

// Loopback / private CIDRs that should never be the resolved client
// IP under a sane deploy. We treat any of these as "the proxy is
// eating the X-Forwarded-For".
const PRIVATE_OR_LOOPBACK_PREFIXES = [
  "127.",
  "10.",
  "192.168.",
  "169.254.",
  "::1",
  "fe80:",
  "fc",
  "fd",
];

function isPrivateOrLoopback(ip: string): boolean {
  if (!ip) return true;
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "127.0.0.1" || lower === "unknown") return true;
  // 172.16.0.0 – 172.31.255.255
  const m = /^172\.(\d+)\./.exec(lower);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return PRIVATE_OR_LOOPBACK_PREFIXES.some((p) => lower.startsWith(p));
}

export interface TrustProxyCheckResult {
  ok: boolean;
  resolvedIp: string;
  trustSetting: unknown;
  reason?: string;
}

// Synthesize a minimal request shape that proxy-addr accepts. The
// real Express `req` object carries far more than this; proxy-addr
// only reads `connection.remoteAddress` and the headers, and
// Express's compiled trust function takes `(addr, hopIndex)`.
function makeFakeReq(forwardedFor: string, socketAddr = "127.0.0.1") {
  return {
    connection: { remoteAddress: socketAddr },
    socket: { remoteAddress: socketAddr },
    headers: { "x-forwarded-for": forwardedFor },
  } as unknown as Parameters<typeof proxyAddr>[0];
}

// Pull the compiled trust function Express stores under the magic
// `trust proxy fn` key (set when you call `app.set('trust proxy', …)`).
// Falling back to a "trust nothing" function is the safest default
// for a probe — if Express never compiled one, the limiter would key
// on the socket address anyway.
function getTrustFn(app: Express): Parameters<typeof proxyAddr>[1] {
  const fn = app.get("trust proxy fn") as
    | Parameters<typeof proxyAddr>[1]
    | undefined;
  return fn ?? (() => false);
}

export function verifyTrustProxy(app: Express): TrustProxyCheckResult {
  const trust = getTrustFn(app);
  // Synthesize the simplest realistic shape: a single proxy hop
  // (Replit's edge in our deploy) puts the client's IP in XFF, and
  // the socket address is loopback because the proxy is local from
  // our pov. Even a 1-hop trust setting must turn this into the
  // client IP — anything less means per-IP limiters key on the
  // proxy's loopback address. Real deployments with deeper chains
  // would still work (they trust >=1 hop), so this is the lower
  // bound the boot guard insists on.
  const fakeReq = makeFakeReq("203.0.113.7");
  const resolvedIp = proxyAddr(fakeReq, trust);
  const trustSetting = app.get("trust proxy");

  if (resolvedIp === "203.0.113.7") {
    return { ok: true, resolvedIp, trustSetting };
  }
  if (isPrivateOrLoopback(resolvedIp)) {
    return {
      ok: false,
      resolvedIp,
      trustSetting,
      reason:
        "trust-proxy is not honoring X-Forwarded-For; req.ip resolved to a loopback/private address. " +
        "Per-IP rate limiters will key on the proxy's address and brute-force protection collapses.",
    };
  }
  // Resolved to a non-loopback but ALSO not the synthetic client —
  // shouldn't happen with the 1-hop synthetic, but surface it loudly
  // rather than silently returning ok.
  return {
    ok: false,
    resolvedIp,
    trustSetting,
    reason: `trust-proxy resolved req.ip to ${resolvedIp} instead of the synthetic client 203.0.113.7.`,
  };
}

// Boot-time guard. In production we hard-fail (the security cost of
// running with a broken rate-limit ceiling outweighs the boot risk).
// In dev we log a high-severity warning so the dev loop isn't broken.
//
// Entrypoint registry (task #378):
//   - server/index.ts ........ main HTTP server
//
// Every entrypoint that constructs an `express()` instance MUST
// call this assertion after `app.set('trust proxy', N)` and before
// the app starts handling requests. The CI guard at
// `scripts/check-trust-proxy-coverage.ts` (exercised by
// `tests/unit/check-trust-proxy-coverage.test.ts` on every CI run)
// walks `server/**/*.ts` and fails if it finds a new `express()`
// instance in a file that doesn't also call this function — when
// adding a new entrypoint, register it in the list above and call
// the assertion in that file.
export function assertTrustProxyAtBoot(
  app: Express,
  opts: {
    isProduction: boolean;
    log: { error: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void };
  },
): TrustProxyCheckResult {
  const result = verifyTrustProxy(app);
  if (result.ok) return result;
  const meta = {
    resolvedIp: result.resolvedIp,
    trustSetting: result.trustSetting,
    reason: result.reason,
  };
  if (opts.isProduction) {
    opts.log.error("Trust-proxy misconfiguration detected at boot", meta);
    throw new Error(
      `Trust-proxy misconfigured: ${result.reason ?? "req.ip did not resolve to the synthetic client address"}`,
    );
  }
  opts.log.warn("Trust-proxy misconfiguration detected at boot (dev — not fatal)", meta);
  return result;
}
