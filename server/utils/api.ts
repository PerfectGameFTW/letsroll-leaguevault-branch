import { Response } from 'express';
import { ZodError } from 'zod';

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
  res.setHeader('Content-Type', 'application/json');
  const response: ApiResponse<T> = {
    success: true,
    data
  };
  res.status(status).json(response);
}

export function sendError(
  res: Response, 
  error: Error | ZodError | string, 
  status = 500,
  code = 'INTERNAL_SERVER_ERROR'
) {
  res.setHeader('Content-Type', 'application/json');
  const response: ApiResponse<null> = {
    success: false,
    error: {
      code,
      message: error instanceof Error ? error.message : error,
      details: error instanceof ZodError ? error.issues : undefined
    }
  };

  res.status(status).json(response);
}