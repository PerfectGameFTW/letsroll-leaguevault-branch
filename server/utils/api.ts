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
  const response: ApiResponse<T> = {
    success: true,
    data
  };
  res.status(status).json(response);
}

export function sendError(
  res: Response, 
  code: string, 
  message: string, 
  status: number = 500,
  details?: any
) {
  // Convert status to number if it's a string
  const statusCode = typeof status === 'string' ? parseInt(status, 10) : status;
  
  // Ensure statusCode is a valid HTTP status
  const finalStatusCode = isNaN(statusCode) ? 500 : statusCode;
  
  const response: ApiResponse<null> = {
    success: false,
    error: {
      code,
      message,
      details
    }
  };

  res.status(finalStatusCode).json(response);
}