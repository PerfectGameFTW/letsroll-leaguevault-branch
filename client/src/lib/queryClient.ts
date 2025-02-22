import { QueryClient } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage;
    try {
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await res.json();
        errorMessage = errorData.message || errorData.error || res.statusText;
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

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  try {
    const apiUrl = ensureApiPrefix(url);
    console.log(`[API] ${method} request to ${apiUrl}`, data ? { data } : '');

    const res = await fetch(apiUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    console.log(`[API] Response from ${apiUrl}:`, {
      status: res.status,
      ok: res.ok,
      statusText: res.statusText
    });

    const validatedRes = await throwIfResNotOk(res);
    return validatedRes;
  } catch (error) {
    console.error(`[API] ${method} request failed:`, error);
    throw error;
  }
}

async function defaultQueryFn({ queryKey }: { queryKey: readonly unknown[] }) {
  try {
    const url = ensureApiPrefix(queryKey[0] as string);
    console.log(`[Query] Fetching ${url}`);

    const res = await fetch(url, {
      credentials: "include",
      headers: {
        "Accept": "application/json"
      }
    });

    const validatedRes = await throwIfResNotOk(res);
    const data = await validatedRes.json();
    console.log(`[Query] Successfully fetched ${url}:`, data);
    return data;
  } catch (error) {
    console.error(`[Query] Error fetching ${queryKey[0]}:`, error);
    throw error;
  }
}

// Create a new QueryClient instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: defaultQueryFn,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      refetchOnReconnect: false,
      staleTime: 5000,
      gcTime: 1000 * 60 * 5,
    },
    mutations: {
      retry: false,
    },
  },
});

// Export the queryClient instance
export { queryClient };

// Reset the entire query cache
export function resetQueryCache() {
  queryClient.clear();
}

// Reset specific queries by their keys
export async function resetQueries(queryKeys: string[]) {
  await Promise.all(
    queryKeys.map(key => queryClient.resetQueries({ queryKey: [key] }))
  );
}

// Invalidate multiple queries at once
export async function invalidateQueries(keys: string[]) {
  console.log('[Query] Invalidating queries:', keys);
  await Promise.all(
    keys.map(key => queryClient.invalidateQueries({ queryKey: [key] }))
  );
}

// Prefetch initial data
export async function prefetchQueries() {
  try {
    console.log('[Query] Prefetching initial data...');
    await Promise.all([
      queryClient.prefetchQuery({ queryKey: ['/api/leagues'] }),
      queryClient.prefetchQuery({ queryKey: ['/api/teams'] }),
      queryClient.prefetchQuery({ queryKey: ['/api/bowlers'] }),
    ]);
    console.log('[Query] Initial data prefetch complete');
  } catch (error) {
    console.error('[Query] Error prefetching initial data:', error);
  }
}