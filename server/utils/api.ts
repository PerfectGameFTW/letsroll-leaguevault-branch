import { Response } from 'express';
import { ZodError } from 'zod';
import { type User } from '@shared/schema.js';

export type SanitizedUser = Omit<User, 'password' | 'inviteToken' | 'inviteTokenExpiry'>;

export function sanitizeUser(user: User): SanitizedUser {
  const { password, inviteToken, inviteTokenExpiry, ...safeUser } = user;
  return safeUser;
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