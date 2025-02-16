import { Response } from 'express';
import { ZodError } from 'zod';

export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
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
  error: ApiError | Error | ZodError | string, 
  status = 500
) {
  let errorResponse: ApiError;

  if (typeof error === 'string') {
    errorResponse = {
      code: 'ERROR',
      message: error
    };
  } else if (error instanceof ZodError) {
    errorResponse = {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: error.errors
    };
  } else if ('code' in error && typeof error.code === 'string') {
    // Handle custom ApiError objects
    errorResponse = error as ApiError;
  } else {
    errorResponse = {
      code: 'SERVER_ERROR',
      message: error instanceof Error ? error.message : 'An unexpected error occurred'
    };
  }

  const response: ApiResponse<null> = {
    success: false,
    error: errorResponse
  };

  res.status(status).json(response);
}