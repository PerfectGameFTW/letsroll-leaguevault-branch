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
  // The user's chosen UI / notification language (task #410 / #417).
  // Safe to expose so the account-settings selector can pre-fill the
  // currently saved value. The column is nullable — null means
  // "no preference, follow the default" (English today).
  'preferredLanguage',
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

/**
 * Parse an optional integer query-string parameter (task #421, lifted
 * out of `server/routes/payments/payment-reports.ts` so every list
 * endpoint can adopt the same contract).
 *
 * Returns `undefined` when the param is missing or is the empty
 * string (the route's "no filter" sentinel — clients that submit a
 * cleared form input must not get a 400) and `null` when the caller
 * sent something we couldn't make sense of — the route maps `null`
 * to a 400 with a per-filter error message.
 *
 * The validation is intentionally STRICT (digits with an optional
 * leading minus, nothing else): the previous `parseInt` + `isNaN`
 * pattern silently accepted partially-numeric input like
 * `?leagueId=42abc` as `42`, which is exactly the failure mode
 * task #406 set out to fix.
 */
export function parseOptionalIntParam(raw: unknown): number | undefined | null {
  if (raw === undefined) return undefined;
  // Express normalizes single-occurrence query params to strings;
  // anything else (array, object) is malformed by definition.
  if (typeof raw !== 'string') return null;
  if (raw === '') return undefined;
  if (!/^-?\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an optional date query-string parameter. Same tri-state
 * contract as `parseOptionalIntParam`: `undefined` = not provided,
 * `null` = unparseable (→ 400), Date = good. `new Date('garbage')`
 * returns an Invalid Date silently, so the old pattern would forward
 * those straight into the storage layer and trip a confusing 500.
 */
export function parseOptionalDateParam(raw: unknown): Date | undefined | null {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return null;
  if (raw === '') return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse an optional comma-separated integer-list query-string
 * parameter (e.g. `?ids=1,2,3`). Same tri-state contract — and a
 * single bad element (`?ids=1,foo,3`) makes the whole list `null` so
 * the caller learns that the request was malformed instead of
 * silently dropping the bad id.
 */
export function parseOptionalIntListParam(raw: unknown): number[] | undefined | null {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return null;
  if (raw === '') return undefined;
  const parts = raw.split(',');
  const result: number[] = [];
  for (const part of parts) {
    if (!/^-?\d+$/.test(part)) return null;
    const n = Number.parseInt(part, 10);
    if (!Number.isFinite(n)) return null;
    result.push(n);
  }
  return result;
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