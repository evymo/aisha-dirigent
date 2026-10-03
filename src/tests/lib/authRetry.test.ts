import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isStaleTokenPermissionError,
  authAwareRetry,
  authAwareRetryDelay,
  refreshSessionCoalesced,
} from "@/lib/reactQuery/authRetry";

// Mock oidc-client (authRetry.ts imports refreshSession from oidc-client)
const mockRefreshSession = vi.fn();
vi.mock("@/integrations/auth/oidc-client", () => ({
  refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
}));

// Mock safeLogger
vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  safeWarn: vi.fn(),
  safeInfo: vi.fn(),
}));

describe("isStaleTokenPermissionError", () => {
  it("should return true for PostgreSQL 42501 error", () => {
    expect(isStaleTokenPermissionError({ code: "42501" })).toBe(true);
  });

  it("should return true for HTTP 401 status", () => {
    expect(isStaleTokenPermissionError({ status: 401 })).toBe(true);
  });

  it("should return false for PGRST202 (function not found)", () => {
    expect(isStaleTokenPermissionError({ code: "PGRST202" })).toBe(false);
  });

  it("should return false for 42883 (undefined function)", () => {
    expect(isStaleTokenPermissionError({ code: "42883" })).toBe(false);
  });

  it("should return false for null/undefined", () => {
    expect(isStaleTokenPermissionError(null)).toBe(false);
    expect(isStaleTokenPermissionError(undefined)).toBe(false);
  });

  it("should return false for non-object errors", () => {
    expect(isStaleTokenPermissionError("string error")).toBe(false);
    expect(isStaleTokenPermissionError(42)).toBe(false);
  });

  it("should return false for generic errors without relevant codes", () => {
    expect(isStaleTokenPermissionError({ code: "23505" })).toBe(false);
    expect(isStaleTokenPermissionError({ message: "some error" })).toBe(false);
  });

  it("should return false for HTTP 400/403/500 errors", () => {
    expect(isStaleTokenPermissionError({ status: 400 })).toBe(false);
    expect(isStaleTokenPermissionError({ status: 403 })).toBe(false);
    expect(isStaleTokenPermissionError({ status: 500 })).toBe(false);
  });
});

describe("authAwareRetry", () => {
  beforeEach(() => {
    mockRefreshSession.mockReset();
    mockRefreshSession.mockResolvedValue({ access_token: "new-token" });
  });

  it("should retry on first 42501 failure and trigger session refresh", () => {
    const error = { code: "42501", message: "permission denied for function get_my_chat_conversations" };
    const shouldRetry = authAwareRetry(0, error);

    expect(shouldRetry).toBe(true);
    // The refresh is fire-and-forget, but should be triggered
    expect(mockRefreshSession).toHaveBeenCalled();
  });

  it("should not retry on second 42501 failure (failureCount > 0)", () => {
    const error = { code: "42501", message: "permission denied" };
    const shouldRetry = authAwareRetry(1, error);

    expect(shouldRetry).toBe(false);
  });

  it("should retry generic errors on first failure (default behavior)", () => {
    const error = { message: "Network error" };
    const shouldRetry = authAwareRetry(0, error);

    expect(shouldRetry).toBe(true);
    // Should NOT trigger refresh for non-auth errors
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it("should not retry generic errors on second failure", () => {
    const error = { message: "Network error" };
    const shouldRetry = authAwareRetry(1, error);

    expect(shouldRetry).toBe(false);
  });

  it("should not trigger refresh for PGRST202 errors", () => {
    const error = { code: "PGRST202", message: "function not found" };
    // failureCount=0, but not a stale token error
    authAwareRetry(0, error);

    expect(mockRefreshSession).not.toHaveBeenCalled();
  });
});

describe("authAwareRetryDelay", () => {
  it("should return 2000ms for 42501 errors (time for session refresh)", () => {
    const error = { code: "42501" };
    expect(authAwareRetryDelay(0, error)).toBe(2_000);
  });

  it("should return 2000ms for 401 status errors", () => {
    const error = { status: 401 };
    expect(authAwareRetryDelay(0, error)).toBe(2_000);
  });

  it("should return exponential backoff for generic errors", () => {
    const error = { message: "Network error" };
    expect(authAwareRetryDelay(0, error)).toBe(1_000);
    expect(authAwareRetryDelay(1, error)).toBe(2_000);
    expect(authAwareRetryDelay(2, error)).toBe(4_000);
  });

  it("should cap exponential backoff at 30 seconds", () => {
    const error = { message: "Network error" };
    expect(authAwareRetryDelay(10, error)).toBe(30_000);
  });
});

describe("refreshSessionCoalesced", () => {
  beforeEach(() => {
    mockRefreshSession.mockReset();
  });

  it("should call refreshSession and return true on success", async () => {
    mockRefreshSession.mockResolvedValue({ access_token: "new-token" });

    const result = await refreshSessionCoalesced();
    expect(result).toBe(true);
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
  });

  it("should return false when refresh returns null", async () => {
    mockRefreshSession.mockResolvedValue(null);

    const result = await refreshSessionCoalesced();
    expect(result).toBe(false);
  });

  it("should return false when refresh returns undefined", async () => {
    mockRefreshSession.mockResolvedValue(undefined);

    const result = await refreshSessionCoalesced();
    expect(result).toBe(false);
  });

  it("should coalesce concurrent refresh calls into one request", async () => {
    let resolveRefresh: ((v: unknown) => void) | undefined;
    mockRefreshSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        })
    );

    // Fire two concurrent refreshes
    const promise1 = refreshSessionCoalesced();
    const promise2 = refreshSessionCoalesced();

    // Only one actual refresh should be in flight
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);

    // Resolve the single refresh
    resolveRefresh!({ access_token: "new-token" });

    const [result1, result2] = await Promise.all([promise1, promise2]);
    expect(result1).toBe(true);
    expect(result2).toBe(true);
  });

  it("should handle exceptions gracefully", async () => {
    mockRefreshSession.mockRejectedValue(new Error("network error"));

    const result = await refreshSessionCoalesced();
    expect(result).toBe(false);
  });
});
