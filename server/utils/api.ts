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
    details?: any;
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

export function parsePaginationParams(query: Record<string, any>): { page: number; limit: number } | null {
  const page = query.page ? parseInt(query.page as string) : undefined;
  const limit = query.limit ? parseInt(query.limit as string) : undefined;

  if (page === undefined && limit === undefined) return null;

  const safePage = (page && !isNaN(page) && page > 0) ? page : 1;
  const safeLimit = (limit && !isNaN(limit) && limit > 0) ? Math.min(limit, 100) : 50;

  return { page: safePage, limit: safeLimit };
}

export function sendError(
  res: Response, 
  codeOrMessage: string, 
  messageOrStatus?: string | number, 
  statusOrCode: number | string = 500,
  details?: any
) {
  let code: string;
  let message: string;
  let status: number;

  // Handle different call patterns
  if (typeof messageOrStatus === 'number') {
    // Called as: sendError(res, code, status)
    code = codeOrMessage;
    message = code; // Use code as message
    status = messageOrStatus;
  } else if (typeof statusOrCode === 'number') {
    // Called as: sendError(res, code, message, status)
    code = codeOrMessage;
    message = messageOrStatus as string || code;
    status = statusOrCode as number;
  } else {
    // Called as: sendError(res, message, status, code)
    // Legacy pattern
    message = codeOrMessage;
    status = typeof messageOrStatus === 'number' ? messageOrStatus : parseInt(messageOrStatus as string, 10) || 500;
    code = typeof statusOrCode === 'string' ? statusOrCode : 'ServerError';
  }
  
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