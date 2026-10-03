import React, { type PropsWithChildren, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { gcTime: Infinity, retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
}

export function createQueryWrapper(queryClient = createTestQueryClient()) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    useEffect(() => {
      return () => {
        queryClient.clear();
      };
    }, []);

    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}
