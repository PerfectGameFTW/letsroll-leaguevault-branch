import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage;
    try {
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await res.json();
        errorMessage = errorData.error?.message || errorData.message || (typeof errorData.error === 'string' ? errorData.error : null) || res.statusText;
      } else {
        errorMessage = await res.text();
      }
    } catch (e) {
      errorMessage = res.statusText;
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

export async function apiRequest<T = any>(
  url: string,
  method: string,
  data?: unknown | undefined,
): Promise<{success: boolean; data: T; error?: {message: string; code?: string}}> {
  try {
    const apiUrl = ensureApiPrefix(url);

    const res = await fetch(apiUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    const validatedRes = await throwIfResNotOk(res);
    const jsonData = await validatedRes.json();
    return jsonData;
  } catch (error) {
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

    if (res.status === 401) {
      return { success: false, data: null, error: { message: "Not authenticated", code: "AUTH_REQUIRED" } };
    }

    const validatedRes = await throwIfResNotOk(res);
    const data = await validatedRes.json();
    return data;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw error;
    }
    console.error(`[Query] Error fetching ${queryKey[0]}:`, error);
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

// Prefetch initial data
export const prefetchQueries = async () => {
  try {
    await Promise.all([
      queryClient.prefetchQuery({ queryKey: ['/api/leagues'] }),
      queryClient.prefetchQuery({ queryKey: ['/api/teams'] }),
      queryClient.prefetchQuery({ queryKey: ['/api/bowlers'] }),
    ]);
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