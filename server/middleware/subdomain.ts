import { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { createLogger } from '../logger';
import { Organization } from '@shared/schema';
import { isSystemAdmin } from '../utils/access-control';

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

async function lookupOrgBySubdomain(subdomain: string): Promise<Organization | null> {
  const cached = orgCache.get(subdomain);
  if (cached && cached.expiry > Date.now()) {
    return cached.org;
  }

  try {
    let org = await storage.getOrganizationBySubdomain(subdomain);

    if (!org) {
      org = await storage.getOrganizationBySlug(subdomain) || null;
    }

    orgCache.set(subdomain, { org: org || null, expiry: Date.now() + CACHE_TTL_MS });
    return org || null;
  } catch (err) {
    log.error(`Failed to lookup org by subdomain "${subdomain}":`, err);
    return null;
  }
}

export function subdomainDetection(req: Request, _res: Response, next: NextFunction) {
  if (isDev) {
    const devOverride = req.query.__org_slug as string | undefined;
    if (devOverride && SLUG_REGEX.test(devOverride)) {
      req.orgSlug = devOverride;
      lookupOrgBySubdomain(devOverride).then((org) => {
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
  lookupOrgBySubdomain(slug).then((org) => {
    req.subdomainOrg = org;
    next();
  }).catch(() => {
    req.subdomainOrg = null;
    next();
  });
}

export function orgSessionGuard(req: Request, res: Response, next: NextFunction) {
  const subdomainOrg = req.subdomainOrg;
  if (!subdomainOrg || !req.isAuthenticated() || !req.user) {
    return next();
  }

  if (isSystemAdmin(req.user)) {
    return next();
  }

  const user = req.user;

  if (user.organizationId === subdomainOrg.id) {
    return next();
  }

  if (user.bowlerId) {
    storage.getBowlerLeagues({ bowlerId: user.bowlerId }).then((entries) => {
      if (entries.length > 0) {
        const leagueIds = entries.map(e => e.leagueId);
        storage.getLeaguesByIds(leagueIds).then((leagues) => {
          const belongsToOrg = leagues.some(l => l.organizationId === subdomainOrg.id);
          if (belongsToOrg) {
            storage.setUserOrganization(user.id, subdomainOrg.id).catch(err =>
              log.error('Failed to set user organization from bowler linkage:', err)
            );
            return next();
          }
          destroySessionAndContinue(req, res, next);
        }).catch(() => destroySessionAndContinue(req, res, next));
      } else {
        destroySessionAndContinue(req, res, next);
      }
    }).catch(() => destroySessionAndContinue(req, res, next));
    return;
  }

  destroySessionAndContinue(req, res, next);
}

function destroySessionAndContinue(req: Request, res: Response, next: NextFunction) {
  req.logout((err) => {
    if (err) {
      log.error('Failed to logout user during org session guard:', err);
      return res.status(401).json({ success: false, error: { message: 'Not authenticated', code: 'AUTH_REQUIRED' } });
    }
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
