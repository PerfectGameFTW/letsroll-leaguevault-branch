import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { createLogger } from '../logger';

const log = createLogger("CSRF");

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
  }
}

const EXEMPT_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/set-password',
  '/auth/validate-invite',
  '/health',
  '/csrf-token',
  '/setup/create-first-admin',
];

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isExemptPath(path: string): boolean {
  return EXEMPT_PATHS.some(exempt => path === exempt || path.startsWith(exempt + '/'));
}

function getOrCreateToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

export function csrfTokenEndpoint(req: Request, res: Response) {
  const token = getOrCreateToken(req);
  res.json({ success: true, data: { token } });
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    return next();
  }

  if (isExemptPath(req.path)) {
    return next();
  }

  if (!req.session) {
    return next();
  }

  const sessionToken = req.session.csrfToken;
  if (!sessionToken) {
    log.warn(`Missing session CSRF token for ${req.method} ${req.path}`);
    return res.status(403).json({
      success: false,
      error: {
        code: 'CSRF_ERROR',
        message: 'CSRF validation failed. Please refresh the page and try again.',
      },
    });
  }

  const headerToken = req.headers['x-csrf-token'] as string | undefined;
  if (!headerToken || headerToken !== sessionToken) {
    log.warn(`CSRF token mismatch for ${req.method} ${req.path}`);
    return res.status(403).json({
      success: false,
      error: {
        code: 'CSRF_ERROR',
        message: 'CSRF validation failed. Please refresh the page and try again.',
      },
    });
  }

  next();
}
