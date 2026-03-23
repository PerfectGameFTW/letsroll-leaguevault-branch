import { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { createLogger } from '../logger';
import { Organization } from '@shared/schema';

const log = createLogger("Subdomain");

const MAIN_DOMAIN = 'leaguevault.app';
const IGNORED_SUBDOMAINS = new Set(['www', 'api', 'admin', 'mail', 'smtp', 'ftp']);
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const isDev = process.env.NODE_ENV !== 'production';

declare global {
  namespace Express {
    interface Request {
      subdomainOrg?: Organization | null;
      orgSlug?: string | null;
    }
  }
}

function extractSubdomain(hostname: string): string | null {
  const host = hostname.split(':')[0].toLowerCase();

  if (host === 'localhost' || host === '127.0.0.1' || host.match(/^\d+\.\d+\.\d+\.\d+$/)) {
    return null;
  }

  if (host.endsWith('.replit.dev') || host.endsWith('.repl.co') || host.endsWith('.picard.replit.dev')) {
    return null;
  }

  if (host === MAIN_DOMAIN || host === `www.${MAIN_DOMAIN}`) {
    return null;
  }

  if (host.endsWith(`.${MAIN_DOMAIN}`)) {
    const sub = host.slice(0, -(MAIN_DOMAIN.length + 1));
    if (!sub || IGNORED_SUBDOMAINS.has(sub) || sub.includes('.')) {
      return null;
    }
    return sub;
  }

  return null;
}

const orgCache = new Map<string, { org: Organization | null; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function lookupOrgBySlug(slug: string): Promise<Organization | null> {
  const cached = orgCache.get(slug);
  if (cached && cached.expiry > Date.now()) {
    return cached.org;
  }

  try {
    let org = await storage.getOrganizationBySlug(slug);

    if (!org && !slug.includes('-')) {
      const allOrgs = await storage.getOrganizations();
      org = allOrgs.find(o => o.slug.replace(/-/g, '') === slug) || null;
    }

    orgCache.set(slug, { org: org || null, expiry: Date.now() + CACHE_TTL_MS });
    return org || null;
  } catch (err) {
    log.error(`Failed to lookup org by slug "${slug}":`, err);
    return null;
  }
}

export function subdomainDetection(req: Request, _res: Response, next: NextFunction) {
  if (isDev) {
    const devOverride = req.query.__org_slug as string | undefined;
    if (devOverride && SLUG_REGEX.test(devOverride)) {
      req.orgSlug = devOverride;
      lookupOrgBySlug(devOverride).then((org) => {
        req.subdomainOrg = org;
        next();
      }).catch(() => next());
      return;
    }
  }

  const hostname = req.hostname || req.headers.host || '';
  const slug = extractSubdomain(hostname);

  if (!slug) {
    req.orgSlug = null;
    req.subdomainOrg = null;
    next();
    return;
  }

  req.orgSlug = slug;
  lookupOrgBySlug(slug).then((org) => {
    req.subdomainOrg = org;
    next();
  }).catch(() => {
    req.subdomainOrg = null;
    next();
  });
}

export function clearSubdomainCache(slug?: string) {
  if (slug) {
    orgCache.delete(slug);
  } else {
    orgCache.clear();
  }
}

export { extractSubdomain };
