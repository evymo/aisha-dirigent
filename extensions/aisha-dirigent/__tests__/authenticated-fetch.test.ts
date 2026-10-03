/**
 * Tests for authenticated-fetch.ts — JWT preflight, 401 retry, structured errors.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────

const mockGetDirigentConfig = vi.fn(() => ({
  aishaUrl: "http://127.0.0.1:57421",
  anonKey: "test-anon-key",
  mcpUrl: "",
  n8nTriggerUrl: "",
  storyId: "",
  expertiseLevel: "expert",
  instanceLabel: "",
  activeProfile: "local",
  profiles: {},
}));

vi.mock("../src/config", () => ({
  getDirigentConfig: (...args: unknown[]) => mockGetDirigentConfig(...args),
}));

const mockSilentRefresh = vi.fn().mockResolvedValue(true);
const mockLogout = vi.fn();
/** JWT with exp = 9999999999 (year 2286) — "valid, not expiring" */
const VALID_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.dGVzdA";
/** JWT with exp = 0 — "already expired" */
const EXPIRED_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjB9.dGVzdA";

const mockGetAuthState = vi.fn(() => ({
  isAuthenticated: true,
  accessToken: VALID_TOKEN,
  refreshToken: "refresh-token",
  userId: "user-123",
  email: "test@example.com",
}));

vi.mock("../src/auth", () => ({
  getAuthState: (...args: unknown[]) => mockGetAuthState(...args),
  silentRefresh: (...args: unknown[]) => mockSilentRefresh(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
}));

vi.mock("../src/resource-tracker", () => ({
  recordApiCall: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  authenticatedFetch,
  parseJwtExp,
  isTokenExpiringSoon,
  errorCodeToL10nKey,
  buildAuthHeaders,
  getBaseUrl,
  isApiReady,
} from "../src/authenticated-fetch";

// ── Tests ───────────────────────────────────

describe("authenticated-fetch.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockSilentRefresh.mockResolvedValue(true);
    mockLogout.mockResolvedValue(undefined);
    mockGetAuthState.mockReturnValue({
      isAuthenticated: true,
      accessToken: VALID_TOKEN,
      refreshToken: "refresh-token",
      userId: "user-123",
      email: "test@example.com",
    });
  });

  // ── parseJwtExp ─────────────────────────────

  describe("parseJwtExp", () => {
    it("extracts exp from valid JWT", () => {
      expect(parseJwtExp(VALID_TOKEN)).toBe(9999999999);
    });

    it("returns null for malformed token", () => {
      expect(parseJwtExp("not-a-jwt")).toBeNull();
    });

    it("returns null for JWT without exp claim", () => {
      // {"alg":"HS256"}.{"sub":"user"}.test
      const noExp = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.dGVzdA";
      expect(parseJwtExp(noExp)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseJwtExp("")).toBeNull();
    });

    it("extracts exp from expired token", () => {
      expect(parseJwtExp(EXPIRED_TOKEN)).toBe(0);
    });
  });

  // ── isTokenExpiringSoon ─────────────────────

  describe("isTokenExpiringSoon", () => {
    it("returns false for far-future token", () => {
      expect(isTokenExpiringSoon()).toBe(false);
    });

    it("returns true for expired token", () => {
      mockGetAuthState.mockReturnValue({
        isAuthenticated: true,
        accessToken: EXPIRED_TOKEN,
        refreshToken: "refresh-token",
        userId: "user-123",
        email: "test@example.com",
      });
      expect(isTokenExpiringSoon()).toBe(true);
    });

    it("returns true when no access token", () => {
      mockGetAuthState.mockReturnValue({
        isAuthenticated: false,
        accessToken: null,
        refreshToken: null,
        userId: null,
        email: null,
      });
      expect(isTokenExpiringSoon()).toBe(true);
    });
  });

  // ── errorCodeToL10nKey ──────────────────────

  describe("errorCodeToL10nKey", () => {
    it("maps token_expired", () => {
      expect(errorCodeToL10nKey("token_expired")).toContain("Session expired");
    });

    it("maps rate_limited", () => {
      expect(errorCodeToL10nKey("rate_limited")).toContain("Too many requests");
    });

    it("maps unknown to unexpected error", () => {
      expect(errorCodeToL10nKey("unknown")).toContain("unexpected error");
    });
  });

  // ── buildAuthHeaders ────────────────────────

  describe("buildAuthHeaders", () => {
    it("includes Authorization and apikey", () => {
      const headers = buildAuthHeaders();
      expect(headers.Authorization).toBe(`Bearer ${VALID_TOKEN}`);
      expect(headers.apikey).toBe("test-anon-key");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("merges extra headers", () => {
      const headers = buildAuthHeaders({ Prefer: "return=representation" });
      expect(headers.Prefer).toBe("return=representation");
      expect(headers.Authorization).toBe(`Bearer ${VALID_TOKEN}`);
    });
  });

  // ── getBaseUrl / isApiReady ─────────────────

  describe("getBaseUrl", () => {
    it("returns aishaUrl from config", () => {
      expect(getBaseUrl()).toBe("http://127.0.0.1:57421");
    });
  });

  describe("isApiReady", () => {
    it("returns true when authenticated with accessToken and baseUrl", () => {
      expect(isApiReady()).toBe(true);
    });

    it("returns false when not authenticated", () => {
      mockGetAuthState.mockReturnValue({
        isAuthenticated: false,
        accessToken: null,
        refreshToken: null,
        userId: null,
        email: null,
      });
      expect(isApiReady()).toBe(false);
    });

    it("returns false when no aishaUrl", () => {
      mockGetDirigentConfig.mockReturnValue({
        aishaUrl: "",
        anonKey: "test-anon-key",
        mcpUrl: "",
        n8nTriggerUrl: "",
        storyId: "",
        expertiseLevel: "expert",
        instanceLabel: "",
        activeProfile: "local",
        profiles: {},
      });
      expect(isApiReady()).toBe(false);
    });
  });

  // ── authenticatedFetch ──────────────────────

  describe("authenticatedFetch", () => {
    it("successful fetch returns ok result", async () => {
      const data = { id: "123", name: "test" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => data,
      });

      const result = await authenticatedFetch<typeof data>("http://127.0.0.1:57421/test");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(data);
        expect(result.status).toBe(200);
      }
    });

    it("does NOT call silentRefresh when token is fresh", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await authenticatedFetch("http://127.0.0.1:57421/test");

      expect(mockSilentRefresh).not.toHaveBeenCalled();
    });

    it("calls silentRefresh on preflight when token is expiring", async () => {
      mockGetAuthState.mockReturnValue({
        isAuthenticated: true,
        accessToken: EXPIRED_TOKEN,
        refreshToken: "refresh-token",
        userId: "user-123",
        email: "test@example.com",
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await authenticatedFetch("http://127.0.0.1:57421/test");

      expect(mockSilentRefresh).toHaveBeenCalledOnce();
    });

    it("retries once on 401 after silentRefresh", async () => {
      // First call returns 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "JWT expired" }),
      });
      // After refresh, retry succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ refreshed: true }),
      });

      const result = await authenticatedFetch("http://127.0.0.1:57421/test");

      expect(mockSilentRefresh).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
    });

    it("logs out on 401 when silentRefresh fails", async () => {
      mockSilentRefresh.mockResolvedValue(false);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "JWT expired" }),
      });

      const result = await authenticatedFetch("http://127.0.0.1:57421/test");

      expect(mockLogout).toHaveBeenCalledOnce();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error_code).toBe("token_expired");
        expect(result.status).toBe(401);
      }
    });

    it("parses canonical backend error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          error_code: "forbidden",
          message: "No access",
        }),
      });

      const result = await authenticatedFetch("http://127.0.0.1:57421/test");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error_code).toBe("forbidden");
        expect(result.error.message).toBe("No access");
      }
    });

    it("handles legacy { error, code } format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          error: "Too many requests",
          code: "RATE_LIMIT",
          retry_after: 30,
        }),
      });

      const result = await authenticatedFetch("http://127.0.0.1:57421/test");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error_code).toBe("rate_limited");
        expect(result.error.retry_after).toBe(30);
      }
    });

    it("falls back to status-based error on plain error body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal error" }),
      });

      const result = await authenticatedFetch("http://127.0.0.1:57421/test");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error_code).toBe("server_error");
        expect(result.error.message).toBe("Internal error");
      }
    });

    it("handles non-JSON error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => { throw new Error("Not JSON"); },
      });

      const result = await authenticatedFetch("http://127.0.0.1:57421/test");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error_code).toBe("server_error");
      }
    });

    it("handles network error (fetch throws)", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await authenticatedFetch("http://127.0.0.1:57421/test");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.error_code).toBe("server_error");
        expect(result.status).toBe(0);
      }
    });

    it("sends correct headers and body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await authenticatedFetch("http://127.0.0.1:57421/test", {
        body: { key: "value" },
        headers: { "X-Custom": "header" },
      });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:57421/test");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({ key: "value" });
      expect(opts.headers.Authorization).toBe(`Bearer ${VALID_TOKEN}`);
      expect(opts.headers["X-Custom"]).toBe("header");
    });

    it("skips auth checks when skipAuth=true", async () => {
      mockGetAuthState.mockReturnValue({
        isAuthenticated: true,
        accessToken: EXPIRED_TOKEN,
        refreshToken: "refresh-token",
        userId: "user-123",
        email: "test@example.com",
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      });

      await authenticatedFetch("http://127.0.0.1:57421/test", { skipAuth: true });

      // No preflight refresh, no 401 retry
      expect(mockSilentRefresh).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("sanitises URLs in error messages", async () => {
      mockFetch.mockRejectedValueOnce(
        new Error("Failed to connect to http://secret-internal.local:8080/api/v1"),
      );

      const result = await authenticatedFetch("http://127.0.0.1:57421/test");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).not.toContain("secret-internal");
        expect(result.error.message).toContain("[internal]");
      }
    });
  });
});
