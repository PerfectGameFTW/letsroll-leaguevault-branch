import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage;
    try {
      // Try to parse error as JSON first
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await res.json();
        errorMessage = errorData.message || errorData.error || res.statusText;
      } else {
        // Fallback to text if not JSON
        errorMessage = await res.text();
      }
    } catch (e) {
      errorMessage = res.statusText;
    }
    throw new Error(`${res.status}: ${errorMessage}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  try {
    console.log(`[API] ${method} request to ${url}`, data ? { data } : '');
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    // Log response details for debugging
    const contentType = res.headers.get("content-type");
    console.log(`[API] Response from ${url}:`, {
      status: res.status,
      contentType,
      ok: res.ok
    });

    await throwIfResNotOk(res);

    // Verify JSON response
    if (!contentType || !contentType.includes("application/json")) {
      console.error(`[API] Expected JSON but got ${contentType} from ${url}`);
      throw new Error(`Expected JSON response but got ${contentType || 'no content type'}`);
    }

    console.log(`[API] ${method} request to ${url} successful`);
    return res;
  } catch (error) {
    console.error(`[API] ${method} request to ${url} failed:`, error);
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
    async ({ queryKey }) => {
      try {
        console.log(`[Query] Fetching ${queryKey[0]}`);
        const res = await fetch(queryKey[0] as string, {
          credentials: "include",
          headers: {
            "Accept": "application/json"
          }
        });

        if (unauthorizedBehavior === "returnNull" && res.status === 401) {
          console.log(`[Query] Unauthorized access to ${queryKey[0]}, returning null`);
          return null;
        }

        await throwIfResNotOk(res);

        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          console.error(`[Query] Expected JSON but got ${contentType} from ${queryKey[0]}`);
          throw new Error(`Expected JSON response but got ${contentType || 'no content type'}`);
        }

        const data = await res.json();
        console.log(`[Query] Successfully fetched ${queryKey[0]}`, data);
        return data;
      } catch (error) {
        console.error(`[Query] Error fetching ${queryKey[0]}:`, error);
        throw error;
      }
    };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      staleTime: 1000 * 60 * 5, // Data remains fresh for 5 minutes
      gcTime: 1000 * 60 * 30, // Cache garbage collection after 30 minutes
      refetchOnWindowFocus: false, // Disable automatic refetch on window focus
      refetchOnMount: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof Error) {
          // Don't retry on 404 or 401
          if (error.message.startsWith('404')) return false;
          if (error.message.startsWith('401')) return false;
          // Don't retry on content type mismatch
          if (error.message.includes('Expected JSON response')) return false;
        }
        return failureCount < 2; // Only retry once
      },
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 5000), // Max 5 second delay
    },
    mutations: {
      retry: false,
      onError: (error) => {
        console.error('[Mutation] Error:', error);
      },
    },
  },
});

// Helper functions for query management
export const prefetchQueries = async () => {
  await Promise.all([
    queryClient.prefetchQuery({ queryKey: ['/api/leagues'] }),
    queryClient.prefetchQuery({ queryKey: ['/api/teams'] }),
    queryClient.prefetchQuery({ queryKey: ['/api/bowlers'] }),
  ]);
};

export const invalidateQueries = async (keys: string[]) => {
  await Promise.all(
    keys.map(key => queryClient.invalidateQueries({ queryKey: [key] }))
  );
};