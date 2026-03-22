import { Response } from 'express';
import { ZodError } from 'zod';
import { type User, type Organization, type PaginationMeta } from '@shared/schema';

export type SanitizedUser = Omit<User, 'password' | 'inviteToken' | 'inviteTokenExpiry'>;

export function sanitizeUser(user: User): SanitizedUser {
  const { password, inviteToken, inviteTokenExpiry, ...safeUser } = user;
  return safeUser;
}

export type SanitizedOrganization = Omit<Organization, 'integrations'>;

export function sanitizeOrg(org: Organization): SanitizedOrganization {
  const { integrations, ...safeOrg } = org;
  return safeOrg;
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