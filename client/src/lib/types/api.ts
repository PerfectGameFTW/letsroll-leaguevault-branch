/**
 * Standard API response type for all endpoints
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * Type guard for checking if a response is an ApiResponse
 */
export function isApiResponse<T>(response: unknown): response is ApiResponse<T> {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    typeof (response as ApiResponse<T>).success === 'boolean' &&
    'data' in response
  );
}

/**
 * Type for handling paginated API responses
 */
export interface PaginatedApiResponse<T> extends ApiResponse<T> {
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
}

/**
 * Type guard for checking if a response is a PaginatedApiResponse
 */
export function isPaginatedApiResponse<T>(
  response: unknown
): response is PaginatedApiResponse<T> {
  return (
    isApiResponse(response) &&
    'pagination' in response &&
    typeof (response as PaginatedApiResponse<T>).pagination === 'object'
  );
}
