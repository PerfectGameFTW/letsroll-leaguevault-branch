import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
    async ({ queryKey }) => {
      const res = await fetch(queryKey[0] as string, {
        credentials: "include",
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // Optimize caching strategy
      staleTime: 1000 * 60 * 5, // Data remains fresh for 5 minutes
      gcTime: 1000 * 60 * 30, // Cache garbage collection after 30 minutes
      // Enable background refetching
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
      // Add retry configuration
      retry: (failureCount, error) => {
        // Retry up to 3 times unless it's a 404 or 401
        if (error instanceof Error && error.message.startsWith('404')) return false;
        if (error instanceof Error && error.message.startsWith('401')) return false;
        return failureCount < 3;
      },
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: false,
      onError: (error) => {
        console.error('Mutation error:', error);
      },
    },
  },
});

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