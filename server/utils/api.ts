import { Response } from 'express';
import { ZodError } from 'zod';
import { type User, type Organization, type PaginationMeta } from '@shared/schema';

// Allowlist projection (deny-by-default) — the safer of the two
// strategies in task #327. Switching from a strip-list (`omit`) to an
// allowlist (`pick`) means a future column on `users` cannot leak
// just because its name happens to dodge the sensitive-name regex
// (e.g. `apiKey`, `clientSecret`, `webhookKey`, `credentials`,
// `authConfig`). Anything not on this list is dropped before the
// payload ever reaches the wire.
//
// Adding a new safe column? Add it here AND extend `SanitizedUser`
// implicitly via the `Pick<>` below. Adding a sensitive column?
// Don't list it. The regression test in
// `tests/unit/sanitize-user.test.ts` walks the live Drizzle schema
// and pins both halves of the contract.
const SAFE_USER_FIELDS = [
  'id',
  'email',
  'bowlerId',
  'name',
  'phone',
  'avatar',
  'role',
  'organizationId',
  'locationId',
  'createdAt',
] as const;

export type SanitizedUser = Pick<User, typeof SAFE_USER_FIELDS[number]>;

export function sanitizeUser(user: User): SanitizedUser {
  const input = user as Record<string, unknown>;
  const safeUser: Record<string, unknown> = {};
  for (const field of SAFE_USER_FIELDS) {
    if (field in input) safeUser[field] = input[field];
  }
  return safeUser as SanitizedUser;
}

// Same allowlist strategy for organizations. The `integrations` JSONB
// column holds OAuth tokens and provider API keys (see
// `OrgIntegrations` in shared/schema/organizations.ts) and was the
// concrete motivating case — but more importantly, anything new that
// lands on the table will be dropped by default until it's
// deliberately added here.
const SAFE_ORG_FIELDS = [
  'id',
  'name',
  'slug',
  'subdomain',
  'address',
  'city',
  'state',
  'zipCode',
  'phone',
  'email',
  'logo',
  'darkLogo',
  'appIcon',
  'active',
  'createdAt',
] as const;

export type SanitizedOrganization = Pick<Organization, typeof SAFE_ORG_FIELDS[number]>;

export function sanitizeOrg(org: Organization): SanitizedOrganization {
  const input = org as Record<string, unknown>;
  const safeOrg: Record<string, unknown> = {};
  for (const field of SAFE_ORG_FIELDS) {
    if (field in input) safeOrg[field] = input[field];
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