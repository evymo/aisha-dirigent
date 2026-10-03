/**
 * Tests for auth.ts — auth state, signup URL construction, token storage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config module
const mockConfig = {
  aishaUrl: "http://127.0.0.1:57421",
  anonKey: "test-anon-key",
  keycloakUrl: "",
  mcpUrl: "",
  n8nTriggerUrl: "",
  storyId: "",
  expertiseLevel: "expert",
  instanceLabel: "",
  activeProfile: "local",
  profiles: {},
};

vi.mock("../src/config", () => ({
  getDirigentConfig: vi.fn(() => ({ ...mockConfig })),
}));

// Mock story-context module
vi.mock("../src/story-context", () => ({
  persistStoryId: vi.fn(),
}));

// Mock resource tracker
vi.mock("../src/resource-tracker", () => ({
  recordApiCall: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function fakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("auth.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    // Reset keycloakUrl to prevent cross-test leaks
    mockConfig.keycloakUrl = "";
  });

  describe("getAuthState", () => {
    it("returns unauthenticated state initially", async () => {
      vi.resetModules();
      const { getAuthState } = await import("../src/auth");
      const state = getAuthState();

      expect(state.isAuthenticated).toBe(false);
      expect(state.accessToken).toBeNull();
      expect(state.userId).toBeNull();
      expect(state.email).toBeNull();
    });
  });

  describe("signup", () => {
    const KC_URL = "http://localhost:8080/realms/aisha";

    it("opens Keycloak registration in the browser", async () => {
      vi.resetModules();
      mockConfig.keycloakUrl = KC_URL;

      const vscode = await import("vscode");
      const openSpy = vi.spyOn(vscode.env, "openExternal");

      const { signup } = await import("../src/auth");
      const result = await signup();

      expect(result).toBe(false);
      expect(openSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          fsPath: expect.stringContaining(`${KC_URL}/protocol/openid-connect/registrations`),
        }),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns false when Keycloak URL is not configured", async () => {
      vi.resetModules();
      mockConfig.keycloakUrl = "";

      const vscode = await import("vscode");
      const errorSpy = vi.spyOn(vscode.window, "showErrorMessage");

      const { signup } = await import("../src/auth");
      const result = await signup();

      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Keycloak URL not configured"),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("shows info message for browser registration", async () => {
      vi.resetModules();
      mockConfig.keycloakUrl = KC_URL;

      const vscode = await import("vscode");
      const infoSpy = vi.spyOn(vscode.window, "showInformationMessage");
      vi.spyOn(vscode.env, "openExternal").mockResolvedValueOnce(true);

      const { signup } = await import("../src/auth");
      const result = await signup();

      expect(result).toBe(false);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("Complete registration"),
      );
    });
  });

  describe("login", () => {
    const KC_URL = "http://localhost:8080/realms/aisha";

    it("routes login() to PKCE flow — opens authorize URL in browser", async () => {
      // `login()` is the user-facing entry that delegates to `loginWithPkce()`
      // (post-refactor: was device auth in older versions, now PKCE for editor
      // UX — desktop opens system browser, web embeds via asExternalUri).
      // Device-auth path is still covered under the `loginWithAishaId`
      // describe block below; this test pins the routing decision so a
      // future refactor doesn't silently swap entry points.
      vi.resetModules();
      mockConfig.keycloakUrl = KC_URL;
      // Do NOT override mockConfig.gateway/backend URLs here — module-level
      // mock state leaks across tests (beforeEach only resets keycloakUrl).
      // The default URL set at the top of the file is sufficient to clear
      // loginWithPkce's early-return guard for missing backend URL.

      const vscode = await import("vscode");
      const openExternalSpy = vi.spyOn(vscode.env, "openExternal").mockResolvedValue(true);

      // Run login() but DON'T await — PKCE waits for an OAuth callback
      // that won't come in the test. We assert on the side-effect (browser
      // open with PKCE authorize URL) which happens synchronously before
      // the await on the progress notification.
      const { login } = await import("../src/auth");
      void login({ skipStoryPick: true });

      // Yield event loop once so the openExternal call settles.
      await Promise.resolve();
      await Promise.resolve();

      expect(openExternalSpy).toHaveBeenCalled();
      const openedUri = openExternalSpy.mock.calls[0][0];
      const openedHref = (openedUri as { toString: () => string }).toString();
      // PKCE authorize endpoint contract: /protocol/openid-connect/auth (no /device
      // suffix); response_type=code; code_challenge_method=S256.
      expect(openedHref).toContain(`${KC_URL}/protocol/openid-connect/auth`);
      expect(openedHref).not.toContain("/auth/device");
      expect(openedHref).toContain("response_type=code");
      expect(openedHref).toContain("code_challenge_method=S256");
    });

    it("shows error when Keycloak URL is missing", async () => {
      vi.resetModules();
      mockConfig.keycloakUrl = "";

      const vscode = await import("vscode");
      const errorSpy = vi.spyOn(vscode.window, "showErrorMessage");

      const { login } = await import("../src/auth");
      const result = await login();

      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Keycloak URL not configured"),
      );
    });
  });

  describe("fetchUserStories", () => {
    it("calls get_my_stories_audited RPC with configured auth", async () => {
      vi.resetModules();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { id: "story-1", title: "Test Story", status: "active" },
        ],
      });

      const { fetchUserStories } = await import("../src/auth");
      const stories = await fetchUserStories();

      expect(stories).toHaveLength(1);
      expect(stories[0].title).toBe("Test Story");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://127.0.0.1:57421/rest/v1/rpc/get_my_stories_audited",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    it("returns empty array on HTTP error", async () => {
      vi.resetModules();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      });
      // silentRefresh retry — also fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      });

      const { fetchUserStories } = await import("../src/auth");
      const stories = await fetchUserStories();

      expect(stories).toEqual([]);
    });
  });

  describe("loginWithAishaId", () => {
    const KC_URL = "http://localhost:8080/realms/aisha";

    const deviceAuthResponse = {
      device_code: "dev-code-123",
      user_code: "ABCD-EFGH",
      verification_uri: `${KC_URL}/protocol/openid-connect/auth/device`,
      verification_uri_complete: `${KC_URL}/protocol/openid-connect/auth/device?user_code=ABCD-EFGH`,
      expires_in: 600,
      interval: 0, // 0 for tests — withProgress mock runs synchronously
    };

    it("returns false when keycloakUrl is not configured", async () => {
      vi.resetModules();
      mockConfig.keycloakUrl = "";

      const vscode = await import("vscode");
      const errorSpy = vi.spyOn(vscode.window, "showErrorMessage");

      const { loginWithAishaId } = await import("../src/auth");
      const result = await loginWithAishaId();

      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Keycloak URL not configured"),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns false when device authorization fails", async () => {
      vi.resetModules();
      mockConfig.keycloakUrl = KC_URL;

      const vscode = await import("vscode");
      const errorSpy = vi.spyOn(vscode.window, "showErrorMessage");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      const { loginWithAishaId } = await import("../src/auth");
      const result = await loginWithAishaId();

      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start device authorization"),
      );
    });

    it("returns false when KC returns access_denied during polling", async () => {
      vi.useFakeTimers();
      vi.resetModules();
      mockConfig.keycloakUrl = KC_URL;

      const vscode = await import("vscode");
      const warnSpy = vi.spyOn(vscode.window, "showWarningMessage");

      // Device auth succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deviceAuthResponse,
      });

      // Polling returns access_denied
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "access_denied" }),
      });

      const { loginWithAishaId } = await import("../src/auth");
      const resultPromise = loginWithAishaId();

      // Advance past poll interval
      await vi.advanceTimersByTimeAsync(5500);

      const result = await resultPromise;
      vi.useRealTimers();

      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Authentication failed (access_denied)"),
      );
    });

    it("completes full flow: device auth → poll → store Keycloak tokens", async () => {
      vi.useFakeTimers();
      vi.resetModules();
      mockConfig.keycloakUrl = KC_URL;

      const vscode = await import("vscode");
      const infoSpy = vi.spyOn(vscode.window, "showInformationMessage");

      // 1. Device auth succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deviceAuthResponse,
      });

      // 2. First poll: authorization_pending
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "authorization_pending" }),
      });

      // 3. Second poll: token issued
      const idToken = fakeJwt({ sub: "user-kc-1", email: "kc@example.com" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "kc-at-123",
          id_token: idToken,
          refresh_token: "kc-rt-789",
        }),
      });

      const { loginWithAishaId } = await import("../src/auth");
      const resultPromise = loginWithAishaId({ skipStoryPick: true });

      // Advance past first poll interval (authorization_pending)
      await vi.advanceTimersByTimeAsync(5500);
      // Advance past second poll interval (success)
      await vi.advanceTimersByTimeAsync(5500);

      const result = await resultPromise;
      vi.useRealTimers();

      expect(result).toBe(true);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("kc@example.com"),
      );

      // Verify device auth call
      expect(mockFetch.mock.calls[0][0]).toBe(
        `${KC_URL}/protocol/openid-connect/auth/device`,
      );

      expect(mockFetch.mock.calls.some((call) => String(call[0]).includes("/auth/v1/token"))).toBe(false);
    });

    it("returns false when Keycloak token has no usable profile", async () => {
      vi.useFakeTimers();
      vi.resetModules();
      mockConfig.keycloakUrl = KC_URL;

      const vscode = await import("vscode");
      const errorSpy = vi.spyOn(vscode.window, "showErrorMessage");

      // Device auth
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deviceAuthResponse,
      });

      // Poll — token issued
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "kc-at",
          id_token: "kc-id",
          refresh_token: "kc-rt",
        }),
      });

      const { loginWithAishaId } = await import("../src/auth");
      const resultPromise = loginWithAishaId();

      // Advance past poll interval
      await vi.advanceTimersByTimeAsync(5500);

      const result = await resultPromise;
      vi.useRealTimers();

      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Identity token does not contain"),
      );
    });

    it("returns false when KC is unreachable", async () => {
      vi.resetModules();
      mockConfig.keycloakUrl = KC_URL;

      const vscode = await import("vscode");
      const errorSpy = vi.spyOn(vscode.window, "showErrorMessage");

      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const { loginWithAishaId } = await import("../src/auth");
      const result = await loginWithAishaId();

      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Could not reach Keycloak"),
      );
    });
  });

  // ── silentRefresh: zombie session prevention ─────

  describe("silentRefresh", () => {
    /** Create a mock SecretStorage pre-loaded with tokens, init auth, return module. */
    async function initAuthWithTokens() {
      vi.resetModules();
      mockConfig.keycloakUrl = "http://localhost:8080/realms/aisha";

      const store = new Map<string, string>([
        ["aisha.dirigent.accessToken", "at-123"],
        ["aisha.dirigent.refreshToken", "rt-456"],
        ["aisha.dirigent.userId", "uid-1"],
        ["aisha.dirigent.userEmail", "test@example.com"],
      ]);

      const mockSecrets = {
        get: async (key: string) => store.get(key),
        store: async (key: string, value: string) => { store.set(key, value); },
        delete: async (key: string) => { store.delete(key); },
        onDidChange: () => ({ dispose: () => {} }),
      };

      const mockContext = {
        secrets: mockSecrets,
        subscriptions: [],
        extensionUri: { fsPath: "/test" },
        globalState: { get: () => undefined, update: async () => {} },
        workspaceState: { get: () => undefined, update: async () => {} },
      };

      // initAuth calls silentRefresh when tokens exist — mock it to succeed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "at-123",
          refresh_token: "rt-456",
          user: { id: "uid-1", email: "test@example.com" },
        }),
      });

      const auth = await import("../src/auth");
      await auth.initAuth(mockContext as never);

      // Verify session is established
      expect(auth.getAuthState().isAuthenticated).toBe(true);
      expect(auth.getAuthState().accessToken).toBe("at-123");

      // Reset fetch mocks for test
      mockFetch.mockReset();
      return { auth, store };
    }

    it("does not logout on network error (zombie session guard)", async () => {
      const { auth } = await initAuthWithTokens();

      // Simulate network failure on silentRefresh
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await auth.silentRefresh();

      // Should return false but NOT logout (tokens preserved)
      expect(result).toBe(false);
      const state = auth.getAuthState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.accessToken).toBe("at-123");
    });

    it("logs out on 401 response (expired refresh token)", async () => {
      const { auth } = await initAuthWithTokens();

      // Simulate 401 on refresh
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "invalid_grant" }),
      });

      const result = await auth.silentRefresh();

      expect(result).toBe(false);
      const state = auth.getAuthState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.accessToken).toBeNull();
    });

    it("does not logout on 500 server error", async () => {
      const { auth } = await initAuthWithTokens();

      // Simulate 500 on refresh — should NOT discard tokens
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "internal" }),
      });

      const result = await auth.silentRefresh();

      expect(result).toBe(false);
      const state = auth.getAuthState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.accessToken).toBe("at-123");
    });
  });
});
