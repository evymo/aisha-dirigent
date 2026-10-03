/**
 * Auth-aware retry logic for React Query.
 *
 * When an RPC call returns PostgreSQL error 42501 (permission denied), it usually
 * means the JWT access token expired and PostgREST fell back to the `anon` role.
 * Instead of propagating the error immediately, we attempt a single session
 * refresh and retry the query.
 *
 * This guards against the race condition where:
 * 1. The tab is backgrounded and the browser throttles the auto-refresh timer
 * 2. The user returns, triggering an RPC call before Supabase's built-in
 *    visibilitychange handler finishes the refresh
 *
 * @module
 */

import { refreshSession } from "@/integrations/auth/oidc-client";
import { safeWarn, safeInfo } from "@/lib/security/safeLogger";

/** PostgreSQL error code for insufficient_privilege */
const PG_PERMISSION_DENIED = "42501";

/** PostgREST error when function is not found */
const PGRST_NOT_FOUND = "PGRST202";

/** PostgreSQL error for undefined function */
const PG_UNDEFINED_FUNCTION = "42883";

/**
 * Checks whether the error is a stale-token permission error (42501)
 * vs. a genuine authorization failure (function not found, wrong role, etc.).
 */
export function isStaleTokenPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as { code?: string; message?: string; status?: number };

  // Don't retry if the function doesn't exist — that's a code/deployment bug
  if (maybeError.code === PGRST_NOT_FOUND || maybeError.code === PG_UNDEFINED_FUNCTION) {
    return false;
  }

  // 42501 = permission denied for function — most likely expired JWT
  if (maybeError.code === PG_PERMISSION_DENIED) {
    return true;
  }

  // PostgREST returns 401 when the JWT is expired
  if (maybeError.status === 401) {
    return true;
  }

  return false;
}

/**
 * Attempt a single session refresh.  Returns `true` if the refresh succeeded,
 * meaning a retry is worthwhile.
 */
async function attemptSessionRefresh(): Promise<boolean> {
  try {
    const kcSession = await refreshSession();
    if (!kcSession) {
      safeWarn("authRetry.refreshFailed", { hasSession: false });
      return false;
    }
    safeInfo("authRetry.refreshSuccess");
    return true;
  } catch {
    safeWarn("authRetry.refreshException");
    return false;
  }
}

/**
 * In-flight refresh promise.  We collapse concurrent refresh requests into
 * one to avoid thundering-herd when multiple queries fail simultaneously.
 */
let inflightRefresh: Promise<boolean> | null = null;

/**
 * Coalesced session refresh — if a refresh is already in progress, piggyback
 * on the existing promise instead of issuing a second one.
 */
export function refreshSessionCoalesced(): Promise<boolean> {
  if (inflightRefresh) return inflightRefresh;

  inflightRefresh = attemptSessionRefresh().finally(() => {
    inflightRefresh = null;
  });

  return inflightRefresh;
}

/**
 * React Query `retry` function that recognises stale-token 42501 errors
 * and attempts one session refresh before giving up.
 *
 * Usage in QueryClient defaultOptions:
 * ```ts
 * retry: authAwareRetry,
 * retryDelay: authAwareRetryDelay,
 * ```
 */
export function authAwareRetry(failureCount: number, error: unknown): boolean {
  // On the very first failure, check if it's a stale-token error
  if (failureCount === 0 && isStaleTokenPermissionError(error)) {
    safeWarn("authRetry.detected42501", { failureCount });
    // Fire-and-forget — the retry will happen after retryDelay, giving the
    // refresh enough time to complete.
    void refreshSessionCoalesced();
    return true;
  }

  // Default: allow up to 1 retry for non-auth errors
  return failureCount < 1;
}

/**
 * Custom retry delay that gives extra time for session refresh on 42501 errors.
 */
export function authAwareRetryDelay(attemptIndex: number, error: unknown): number {
  if (isStaleTokenPermissionError(error)) {
    // 2 seconds — enough for the session refresh round-trip
    return 2_000;
  }

  // Default exponential backoff: 1s, 2s, 4s, ... capped at 30s
  return Math.min(1_000 * 2 ** attemptIndex, 30_000);
}
