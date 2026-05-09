import type { Request, Response, NextFunction } from "express";
import { db } from "../db.js";
import { eq } from "drizzle-orm";
import { leagues, organizations } from "@shared/schema";
import { createLogger } from "../logger";
import { env, isDev } from "../config";

const log = createLogger("EmbedCSP");

/**
 * Task #681 — per-org iframe allowlist for `/embed/register/:leagueId`.
 *
 * The default helmet CSP set in `server/middleware/security.ts` locks
 * `frame-ancestors` to `'self'` + `APP_DOMAIN`. The embed flow's whole
 * purpose is to be iframed from third-party parent pages (a bowling
 * center's WordPress site, etc), so we override that header with the
 * org's `allowedEmbedDomains` whitelist on responses to the embed page.
 *
 * Mounted BEFORE the Vite/static catch-all so we can resolve the league
 * → org row and attach a one-shot wrapper around `res.setHeader`. The
 * wrapper rewrites helmet's `Content-Security-Policy` value when it is
 * later set by the catch-all serving `index.html` (or when no CSP header
 * was set at all). In dev where helmet allows `frame-ancestors *`, we
 * still emit our own narrower directive so the dev/prod allowlist
 * behaves consistently.
 */
export function embedFrameAncestorsOverride(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const match = req.path.match(/^\/embed\/register\/(\d+)\/?$/);
  if (!match) return next();
  const leagueId = parseInt(match[1], 10);
  if (!Number.isFinite(leagueId) || leagueId <= 0) return next();

  // Resolve allowlist before the response is sent so we can rewrite
  // any CSP header set by helmet downstream. Failures fall back to
  // the safe default (no third-party embed allowed) rather than
  // letting the page render without a frame-ancestors restriction.
  resolveAllowedDomains(leagueId)
    .then((domains) => {
      const directive = buildFrameAncestorsDirective(domains);
      patchCspHeader(res, directive);
      next();
    })
    .catch((err) => {
      log.warn(`Failed to resolve embed allowlist for league ${leagueId}`, err);
      patchCspHeader(res, buildFrameAncestorsDirective([]));
      next();
    });
}

async function resolveAllowedDomains(leagueId: number): Promise<string[]> {
  const [row] = await db
    .select({ allowed: organizations.allowedEmbedDomains })
    .from(leagues)
    .innerJoin(organizations, eq(organizations.id, leagues.organizationId))
    .where(eq(leagues.id, leagueId));
  return row?.allowed ?? [];
}

function buildFrameAncestorsDirective(domains: string[]): string {
  const sources = ["'self'", `https://${env.APP_DOMAIN}`, `https://*.${env.APP_DOMAIN}`];
  for (const host of domains) {
    sources.push(`https://${host}`);
  }
  return `frame-ancestors ${sources.join(" ")}`;
}

function patchCspHeader(res: Response, frameAncestors: string): void {
  const original = res.setHeader.bind(res);
  // Replace any existing frame-ancestors in helmet's CSP and ensure
  // a value is set even if helmet hasn't fired yet by the time the
  // response is finalized.
  let written = false;
  res.setHeader = function patched(name: string, value: number | string | readonly string[]) {
    if (typeof name === "string" && name.toLowerCase() === "content-security-policy") {
      const merged = mergeFrameAncestors(String(value), frameAncestors);
      written = true;
      return original(name, merged);
    }
    return original(name, value);
  } as typeof res.setHeader;

  res.on("headersSent", () => {
    void written;
  });

  // Set a baseline so /embed/register/* responses always carry a
  // frame-ancestors directive, even on dev where helmet uses `*`.
  // This will be replaced by the wrapper above if helmet fires.
  if (isDev) {
    original("Content-Security-Policy", frameAncestors);
  }
}

function mergeFrameAncestors(existing: string, frameAncestors: string): string {
  if (!existing) return frameAncestors;
  const directives = existing
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && !d.toLowerCase().startsWith("frame-ancestors"));
  directives.push(frameAncestors);
  return directives.join("; ");
}
