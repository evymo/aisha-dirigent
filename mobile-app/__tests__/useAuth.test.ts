/**
 * Tests for useAuth hook.
 * Verifies KC OIDC-based sign-in, sign-out, and session management.
 */
import { renderHook, act, waitFor } from "@testing-library/react-native";

// Mock KC OIDC module
const mockGetSession = jest.fn();
const mockGetAccessToken = jest.fn();

const mockZahodMistniRelaci = jest.fn();
jest.mock("@/config/oidc", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
  zahodMistniRelaci: (...args: unknown[]) => mockZahodMistniRelaci(...args),
}));

/**
 * Značka instalace — VÝCHOZÍ je „appka už tu běžela".
 *
 * ⛔ Bez tohohle mocku vypadá každý test jako první běh po instalaci, hook
 *    relaci uklidí a `isAuthenticated` je false. Není to vada testu ani hooku:
 *    je to přesně ta nová vlastnost, jen musí být řečeno, KTERÝ případ se měří.
 */
const mockJePrvniBeh = jest.fn();
const mockOznacInstalaci = jest.fn();
jest.mock("@/lib/cerstvaInstalace", () => ({
  jePrvniBehPoInstalaci: (...args: unknown[]) => mockJePrvniBeh(...args),
  oznacInstalaci: (...args: unknown[]) => mockOznacInstalaci(...args),
}));

// Mock AuthService
const mockSignInWithOAuth = jest.fn();
const mockSignOut = jest.fn();

jest.mock("@/services/auth", () => ({
  authService: {
    signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
    signOut: (...args: unknown[]) => mockSignOut(...args),
  },
}));

jest.mock("@/config/sentry", () => ({
  setSentryUser: jest.fn(),
  clearSentryUser: jest.fn(),
}));

jest.mock("@/lib/security/safeLogger", () => ({
  safeInfo: jest.fn(),
  safeError: jest.fn(),
}));

jest.mock("@/hooks/useNotifications", () => ({
  unregisterPushSessionForCurrentDevice: jest.fn().mockResolvedValue(undefined),
}));

import { useAuth } from "@/hooks/useAuth";

describe("useAuth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(null);
    // Výchozí svět: appka už na tomhle zařízení běžela.
    mockJePrvniBeh.mockResolvedValue(false);
    mockOznacInstalaci.mockResolvedValue(undefined);
    mockZahodMistniRelaci.mockResolvedValue(undefined);
  });

  it("po PŘEINSTALACI zahodí relaci a nechá člověka nepřihlášeného", async () => {
    /**
     * ⛔ Naměřeno 2026-09-01: iOS Keychain přežívá smazání aplikace, takže po
     *    nové instalaci ležela v úložišti stará relace, hook z ní usoudil na
     *    přihlášení a `index.tsx` poslal člověka na předvolby — pryč od
     *    přihlašovací obrazovky, kde jediné je tichá cesta k zaťukání.
     */
    mockJePrvniBeh.mockResolvedValue(true);
    mockGetSession.mockResolvedValue({ user: { id: "u1" } });

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockZahodMistniRelaci).toHaveBeenCalledTimes(1);
    expect(mockOznacInstalaci).toHaveBeenCalledTimes(1);
  });

  it("starts in loading state", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("resolves to unauthenticated when no session", async () => {
    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("resolves to authenticated when session exists", async () => {
    const fakeUser = { id: "user-123", email: "test@test.com", fullName: "Test", roles: [] };
    mockGetSession.mockResolvedValue({
      tokens: { accessToken: "test-token", refreshToken: "rt", idToken: "id", expiresAt: Date.now() + 3600000 },
      user: fakeUser,
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.id).toBe("user-123");
  });

  it("signInWithOAuth calls authService.signInWithOAuth", async () => {
    mockSignInWithOAuth.mockResolvedValue({});

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.signInWithOAuth("google");
    });

    expect(mockSignInWithOAuth).toHaveBeenCalledWith("google");
  });

  it("signOut calls authService.signOut", async () => {
    mockSignOut.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockSignOut).toHaveBeenCalled();
  });

  it("refreshAuthState re-reads session from OIDC", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);

    // Now session appears
    const fakeUser = { id: "user-456", email: "new@test.com", fullName: "New", roles: [] };
    mockGetSession.mockResolvedValueOnce({
      tokens: { accessToken: "t2", refreshToken: "rt2", idToken: "id2", expiresAt: Date.now() + 3600000 },
      user: fakeUser,
    });

    await act(async () => {
      await result.current.refreshAuthState();
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.id).toBe("user-456");
  });
});
