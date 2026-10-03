/**
 * Authenticated fetch wrapper for AISHA Dirigent extension.
 *
 * Provides centralised fetch with:
 * - Preflight JWT `exp` check (proactive refresh before expiry)
 * - 401 detection → silent refresh → single retry
 * - Structured error parsing
 * - Deterministic logout on unrecoverable auth failure
 *
 * All story-service, story-chat-view, and auth data calls should use this wrapper.
 *
 * @module
 */

import * as vscode from "vscode";
import { getAuthState, silentRefresh, logout } from "./auth";
import { getDirigentConfig } from "./config";
import { recordApiCall } from "./resource-tracker";

// ── Types ───────────────────────────────────

/** Standard error response from backend edge functions. */
export interface BackendErrorResponse {
  error_code:
    | "token_expired"
    | "unauthorized"
    | "forbidden"
    | "consent_required"
    | "rate_limited"
    | "server_error"
    | "service_unavailable"
    | "not_found"
    | "bad_request"
    | "credits_exhausted"
    | "ai_timeout"
    | "unknown";
  message: string;
  retry_after?: number;
}

/** Result from authenticatedFetch — either success or typed error. */
export type FetchResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: BackendErrorResponse; status: number };

// ── Constants ───────────────────────────────

/** Default threshold in seconds — refresh proactively when JWT has less time left. */
const EXPIRY_THRESHOLD_SEC = 60;

/** Default request timeout in ms. */
const DEFAULT_TIMEOUT_MS = 15_000;

// ── JWT helpers ─────────────────────────────

/**
 * Parse the `exp` claim from a JWT without verifying the signature.
 * Returns the expiration timestamp in seconds, or null if unparseable.
 */
export function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Check whether the current access token is expiring within the given threshold.
 * Returns true if token is missing, unparseable, or within threshold of expiry.
 */
export function isTokenExpiringSoon(thresholdSec: number = EXPIRY_THRESHOLD_SEC): boolean {
  const auth = getAuthState();
  if (!auth.accessToken) return true;
  const exp = parseJwtExp(auth.accessToken);
  if (exp === null) return true;
  return exp - Math.floor(Date.now() / 1000) < thresholdSec;
}

// ── Error mapping ───────────────────────────

/**
 * Map a raw backend response body to a structured BackendErrorResponse.
 * Handles multiple backend conventions:
 * - `{ error_code, message }` — canonical structured form
 * - `{ error, code }` — legacy ai-story-consult
 * - `{ error }` — minimal form
 * - `{ msg }` — GoTrue errors
 */
function parseBackendError(
  status: number,
  body: unknown,
): BackendErrorResponse {
  const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  // Canonical form
  if (typeof obj.error_code === "string" && typeof obj.message === "string") {
    return {
      error_code: obj.error_code as BackendErrorResponse["error_code"],
      message: obj.message,
      retry_after: typeof obj.retry_after === "number" ? obj.retry_after : undefined,
    };
  }

  // Legacy { error, code } from ai-story-consult
  if (typeof obj.code === "string") {
    const codeMap: Record<string, BackendErrorResponse["error_code"]> = {
      RATE_LIMIT: "rate_limited",
      CREDITS_EXHAUSTED: "credits_exhausted",
      AI_AUTH_ERROR: "service_unavailable",
      AI_BAD_REQUEST: "bad_request",
      AI_SERVICE_UNAVAILABLE: "service_unavailable",
      AI_TIMEOUT: "ai_timeout",
      UNAUTHORIZED: "unauthorized",
      FORBIDDEN: "forbidden",
      NOT_FOUND: "not_found",
    };
    return {
      error_code: codeMap[obj.code] ?? "server_error",
      message: typeof obj.error === "string" ? obj.error : `Backend error (${status})`,
      retry_after: typeof obj.retry_after === "number" ? obj.retry_after : undefined,
    };
  }

  // Status-based fallback
  const message = typeof obj.error === "string"
    ? obj.error
    : typeof obj.msg === "string"
      ? obj.msg
      : `Backend error (${status})`;

  if (status === 401) return { error_code: "token_expired", message };
  if (status === 403) return { error_code: "forbidden", message };
  if (status === 404) return { error_code: "not_found", message };
  if (status === 429) return { error_code: "rate_limited", message };
  return { error_code: status >= 500 ? "server_error" : "unknown", message };
}

/**
 * Map a BackendErrorResponse error_code to a VS Code l10n key.
 */
export function errorCodeToL10nKey(code: BackendErrorResponse["error_code"]): string {
  switch (code) {
    case "token_expired":
      return "Session expired. Please log in again.";
    case "unauthorized":
      return "Authentication required.";
    case "forbidden":
      return "You do not have access to this resource.";
    case "consent_required":
      return "Consent is required to access this resource.";
    case "rate_limited":
      return "Too many requests. Please try again later.";
    case "not_found":
      return "The requested resource was not found.";
    case "bad_request":
      return "The request could not be processed.";
    case "service_unavailable":
    case "ai_timeout":
    case "credits_exhausted":
      return "The service is temporarily unavailable. Please try again later.";
    case "server_error":
      return "Server error. Please try again later.";
    default:
      return "An unexpected error occurred.";
  }
}

// ── Sanitisation ────────────────────────────

/**
 * Strip internal URLs and truncate error messages for safe display.
 * Mirrors the pattern from participant.ts sanitizeErrorForChat().
 */
function sanitizeError(raw: string): string {
  const noUrls = raw.replace(/https?:\/\/[^\s)]+/g, "[internal]");
  return noUrls.length > 200 ? noUrls.slice(0, 200) + "…" : noUrls;
}

// ── Core fetch wrapper ──────────────────────

/**
 * Build standard request headers for authenticated API calls.
 */
export function buildAuthHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const config = getDirigentConfig();
  const auth = getAuthState();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.accessToken}`,
    apikey: config.anonKey ?? "",
    ...extraHeaders,
  };
}

/**
 * Build the base URL for the configured AISHA backend instance.
 */
export function getBaseUrl(): string {
  return getDirigentConfig().aishaUrl ?? "";
}

/**
 * Check whether the extension is ready to make API calls
 * (authenticated with a valid accessToken and baseUrl).
 */
export function isApiReady(): boolean {
  const auth = getAuthState();
  return !!(auth.isAuthenticated && auth.accessToken && getBaseUrl());
}

export interface AuthenticatedFetchOptions {
  /** HTTP method — defaults to POST. */
  method?: string;
  /** Request body (will be JSON.stringified). */
  body?: unknown;
  /** Request timeout in ms — defaults to 15000. */
  timeoutMs?: number;
  /** Extra headers to merge. */
  headers?: Record<string, string>;
  /** Category for resource tracking — defaults to "rpc". */
  trackingCategory?: import("./resource-tracker").ApiCategory;
  /** If true, skip preflight token check and 401 retry (e.g. for login itself). */
  skipAuth?: boolean;
}

/**
 * Perform an authenticated fetch with proactive JWT refresh, 401 retry, and
 * structured error parsing. All data-layer calls should use this wrapper.
 *
 * Flow:
 * 1. Preflight — if JWT expires within 60s, refresh proactively.
 * 2. Execute fetch.
 * 3. On 401 — call silentRefresh(), then retry once with new token.
 * 4. On retry failure or other error — return structured error.
 * 5. On hard auth failure (refresh returns 4xx) — deterministic logout.
 */
export async function authenticatedFetch<T = unknown>(
  url: string,
  options: AuthenticatedFetchOptions = {},
): Promise<FetchResult<T>> {
  const {
    method = "POST",
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers: extraHeaders,
    trackingCategory = "rpc",
    skipAuth = false,
  } = options;

  // Preflight: proactive refresh when token is about to expire
  if (!skipAuth && isTokenExpiringSoon(EXPIRY_THRESHOLD_SEC)) {
    await silentRefresh();
  }

  const doFetch = async (): Promise<Response> => {
    const fetchHeaders = buildAuthHeaders(extraHeaders);
    const fetchOptions: RequestInit = {
      method,
      headers: fetchHeaders,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }
    return fetch(url, fetchOptions);
  };

  const t0 = performance.now();

  try {
    let response = await doFetch();
    let latency = performance.now() - t0;

    // 401 → try refresh + retry once
    if (response.status === 401 && !skipAuth) {
      const refreshed = await silentRefresh();
      if (refreshed) {
        // Retry with new token
        response = await doFetch();
        latency = performance.now() - t0;
      } else {
        // Refresh failed — deterministic logout
        await logout();
        recordApiCall(trackingCategory, latency, 0, true);
        return {
          ok: false,
          status: 401,
          error: {
            error_code: "token_expired",
            message: vscode.l10n.t("Session expired. Please log in again."),
          },
        };
      }
    }

    if (!response.ok) {
      recordApiCall(trackingCategory, latency, 0, true);
      let errorBody: unknown = {};
      try {
        errorBody = await response.json();
      } catch {
        // Non-JSON error response — use status-based fallback
      }
      return {
        ok: false,
        status: response.status,
        error: parseBackendError(response.status, errorBody),
      };
    }

    const data = (await response.json()) as T;
    const dataSize = JSON.stringify(data).length;
    recordApiCall(trackingCategory, latency, dataSize, false);
    return { ok: true, data, status: response.status };
  } catch (err) {
    const latency = performance.now() - t0;
    recordApiCall(trackingCategory, latency, 0, true);

    // Network / timeout error
    const message = err instanceof Error ? sanitizeError(err.message) : "Network error";
    return {
      ok: false,
      status: 0,
      error: {
        error_code: "server_error",
        message,
      },
    };
  }
}
