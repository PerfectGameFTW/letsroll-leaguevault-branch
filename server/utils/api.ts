import { Response } from 'express';
import { ZodError } from 'zod';
import { type User, type Organization, type PaginationMeta } from '@shared/schema';

// Fields on `users` that must never leave the server. Any new column whose
// name matches /token|secret|password/i must either be added here or
// explicitly justified as safe to return — the regression test in
// `tests/unit/sanitize-user.test.ts` enforces that contract by scanning a
// fully-populated User and failing loudly on any leaked sensitive-looking
// field name.
const SENSITIVE_USER_FIELDS = ['password', 'inviteToken', 'inviteTokenExpiry'] as const;

export type SanitizedUser = Omit<User, typeof SENSITIVE_USER_FIELDS[number]>;

export function sanitizeUser(user: User): SanitizedUser {
  const safeUser = { ...user } as Record<string, unknown>;
  for (const field of SENSITIVE_USER_FIELDS) {
    delete safeUser[field];
  }
  return safeUser as SanitizedUser;
}

// Fields on `organizations` that must never leave the server. The
// `integrations` JSONB column holds OAuth tokens and provider API keys
// (see `OrgIntegrations` in shared/schema/organizations.ts). Any new
// column whose name matches /token|secret|password/i must either be
// added here or explicitly justified as safe to return — the regression
// test in `tests/unit/sanitize-org.test.ts` enforces that contract by
// scanning every column on the live Drizzle schema.
const SENSITIVE_ORG_FIELDS = ['integrations'] as const;

export type SanitizedOrganization = Omit<Organization, typeof SENSITIVE_ORG_FIELDS[number]>;

export function sanitizeOrg(org: Organization): SanitizedOrganization {
  const safeOrg = { ...org } as Record<string, unknown>;
  for (const field of SENSITIVE_ORG_FIELDS) {
    delete safeOrg[field];
  }
  return safeOrg as SanitizedOrganization;
}

export function sanitizeOrgs(orgs: Organization[]): SanitizedOrganization[] {
  return orgs.map(sanitizeOrg);
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function sendSuccess<T>(res: Response, data: T, status = 200) {
  const response: ApiResponse<T> = {
    success: true,
    data
  };
  res.status(status).json(response);
}

export function sendPaginatedSuccess<T>(res: Response, data: T[], pagination: PaginationMeta, status = 200) {
  res.status(status).json({
    success: true,
    data,
    pagination,
  });
}

export function parsePaginationParams(query: Record<string, unknown>): { page: number; limit: number } | null {
  const page = query.page ? parseInt(query.page as string) : undefined;
  const limit = query.limit ? parseInt(query.limit as string) : undefined;

  if (page === undefined && limit === undefined) return null;

  const safePage = (page && !isNaN(page) && page > 0) ? page : 1;
  const safeLimit = (limit && !isNaN(limit) && limit > 0) ? Math.min(limit, 100) : 50;

  return { page: safePage, limit: safeLimit };
}

export function handleZodError(res: Response, error: ZodError) {
  sendError(res, 'Validation error', 400, 'VALIDATION_ERROR', error.format());
}

/**
 * If the error came from one of the typed user-org guards
 * (`NonAdminMissingOrgError` / `OrgHasUsersError`), responds with
 * a 400 ORG_REQUIRED and returns true so the caller can short-circuit.
 * Otherwise returns false and the caller should fall through to its
 * normal error handling.
 */
export function handleUserOrgError(res: Response, error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name;
  if (name === 'NonAdminMissingOrgError' || name === 'OrgHasUsersError') {
    const message = (error as { message?: string }).message ||
      'Non-admin users must belong to an organization.';
    sendError(res, message, 400, 'ORG_REQUIRED');
    return true;
  }
  return false;
}

export function sendError(
  res: Response,
  message: string,
  status: number = 500,
  code: string = 'ServerError',
  details?: unknown
) {
  const response: ApiResponse<null> = {
    success: false,
    error: {
      code,
      message,
      details
    }
  };

  res.status(status).json(response);
}