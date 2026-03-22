import { QueryClient, QueryFunction } from "@tanstack/react-query";

let csrfToken: string | null = null;
let csrfFetchPromise: Promise<string> | null = null;

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch('/api/csrf-token', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch CSRF token');
  const json = await res.json();
  csrfToken = json.data.token;
  return csrfToken!;
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfFetchPromise) {
    csrfFetchPromise = fetchCsrfToken().finally(() => { csrfFetchPromise = null; });
  }
  return csrfFetchPromise;
}

export function clearCsrfToken() {
  csrfToken = null;
}

export function initCsrfToken() {
  getCsrfToken().catch(() => {});
}

export async function csrfFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (needsCsrf) {
    const token = await getCsrfToken();
    const existingHeaders = init?.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : (init?.headers as Record<string, string>) || {};
    init = {
      ...init,
      headers: {
        ...existingHeaders,
        'x-csrf-token': token,
      },
    };
  }

  return fetch(input, init);
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage;
    let errorCode: string | undefined;
    try {
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await res.json();
        errorMessage = errorData.error?.message || errorData.message || (typeof errorData.error === 'string' ? errorData.error : null) || res.statusText;
        errorCode = errorData.error?.code;
      } else {
        errorMessage = await res.text();
      }
    } catch (e) {
      errorMessage = res.statusText;
    }

    if (res.status === 403 && errorCode === 'CSRF_ERROR') {
      csrfToken = null;
    }

    throw new Error(`${res.status}: ${errorMessage}`);
  }
  return res;
}

function ensureApiPrefix(url: string): string {
  if (!url.startsWith('/api/')) {
    return `/api${url}`;
  }
  return url;
}

async function doApiRequest<T = any>(
  url: string,
  method: string,
  data?: unknown | undefined,
): Promise<{success: boolean; data: T; error?: {message: string; code?: string}}> {
  const apiUrl = ensureApiPrefix(url);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
  if (needsCsrf) {
    headers['x-csrf-token'] = await getCsrfToken();
  }

  const res = await fetch(apiUrl, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  const validatedRes = await throwIfResNotOk(res);
  const jsonData = await validatedRes.json();
  return jsonData;
}

export async function apiRequest<T = any>(
  url: string,
  method: string,
  data?: unknown | undefined,
): Promise<{success: boolean; data: T; error?: {message: string; code?: string}}> {
  try {
    return await doApiRequest<T>(url, method, data);
  } catch (error: any) {
    if (error?.message?.startsWith('403:') && csrfToken === null) {
      try {
        await fetchCsrfToken();
        return await doApiRequest<T>(url, method, data);
      } catch (retryError) {
        console.error(`[API] ${method} retry after CSRF refresh failed:`, retryError);
        throw retryError;
      }
    }
    console.error(`[API] ${method} request failed:`, error);
    throw error;
  }
}

export const getQueryFn: QueryFunction = async ({ queryKey, signal }) => {
  try {
    const url = ensureApiPrefix(queryKey[0] as string);

    const res = await fetch(url, {
      credentials: "include",
      headers: {
        "Accept": "application/json"
      },
      signal,
    });

    const validatedRes = await throwIfResNotOk(res);
    const data = await validatedRes.json();
    return data;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return undefined;
    }
    const is401 = typeof error?.message === 'string' && error.message.startsWith('401');
    if (!is401) {
      console.error(`[Query] Error fetching ${queryKey[0]}:`, error);
    }
    throw error;
  }
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn,
      retry: 1, // Allow one retry
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      refetchOnReconnect: false,
      staleTime: 5000, // Consider data stale after 5 seconds
      gcTime: 1000 * 60 * 5, // Keep unused data in cache for 5 minutes
      // suspense: false, // Removed due to compatibility with TanStack Query v5
    },
    mutations: {
      retry: false,
    },
  },
});

// Reset the entire query cache
export const resetQueryCache = () => {
  queryClient.clear();
};

// Reset specific queries by their keys
export const resetQueries = async (queryKeys: string[]) => {
  await Promise.all(
    queryKeys.map(key => queryClient.resetQueries({ queryKey: [key] }))
  );
};

export const prefetchQueries = async (role: 'admin' | 'bowler') => {
  try {
    if (role === 'admin') {
      await queryClient.prefetchQuery({ queryKey: ['/api/leagues'] });
    } else {
      await queryClient.prefetchQuery({ queryKey: ['/api/bowler-leagues'] });
    }
  } catch (error) {
    console.error('[Query] Error prefetching initial data:', error);
  }
};

// Invalidate multiple queries at once
export const invalidateQueries = async (keys: string[]) => {
  await Promise.all(
    keys.map(key => queryClient.invalidateQueries({ queryKey: [key] }))
  );
};