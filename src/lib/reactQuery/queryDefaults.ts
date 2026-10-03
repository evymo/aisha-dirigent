import { authAwareRetry, authAwareRetryDelay } from "./authRetry";

export const DEFAULT_QUERY_OPTIONS = {
  staleTime: 5 * 60 * 1000, // 5 minutes
  gcTime: 10 * 60 * 1000, // 10 minutes
  retry: authAwareRetry,
  retryDelay: authAwareRetryDelay,
  refetchOnWindowFocus: false,
} as const;

/**
 * Defaults for public, non-authenticated queries.
 * Public data tends to be stable and can be cached longer to prevent homepage flicker.
 */
export const PUBLIC_QUERY_OPTIONS = {
  staleTime: 10 * 60 * 1000, // 10 minutes
  gcTime: 60 * 60 * 1000, // 60 minutes
} as const;
