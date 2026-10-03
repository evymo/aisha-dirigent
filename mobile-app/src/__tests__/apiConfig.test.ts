/**
 * Tests for mobile API backend URL handling.
 */

const mockSecureStore = new Map<string, string>();

jest.mock("expo-constants", () => ({
  expoConfig: {
    extra: {
      EXPO_PUBLIC_AISHA_GATEWAY_URL: "https://api.example.test",
      EXPO_PUBLIC_AISHA_GATEWAY_ANON_KEY: "anon-key",
    },
  },
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

jest.mock("@aisha/api-core", () => ({
  createApiCore: jest.fn(() => ({
    rpc: jest.fn(),
    invoke: jest.fn(),
  })),
  createRealtimeClient: jest.fn(() => ({
    channel: jest.fn(),
    removeChannel: jest.fn(),
  })),
}));

jest.mock("@/config/oidc", () => ({
  getAccessToken: jest.fn(async () => null),
}));

jest.mock("@/lib/security/safeLogger", () => ({
  safeError: jest.fn(),
  safeInfo: jest.fn(),
  safeWarn: jest.fn(),
}));

import Constants from "expo-constants";
import {
  checkBackendHealth,
  getBackendUrl,
  isGatewayPinned,
  normalizeBackendUrl,
  setBackendUrl,
  switchEnvironment,
} from "@/config/api";

describe("api config backend URL validation", () => {
  beforeEach(() => {
    mockSecureStore.clear();
    jest.clearAllMocks();
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as jest.Mock;
  });

  it("normalizes plain http(s) backend URLs", () => {
    expect(normalizeBackendUrl(" https://api.example.test/rest/ ")).toBe("https://api.example.test/rest");
    expect(normalizeBackendUrl("http://127.0.0.1:3001/")).toBe("http://127.0.0.1:3001");
  });

  it("rejects backend URLs that could exfiltrate tokens or break attributes", () => {
    expect(() => normalizeBackendUrl("javascript:alert(1)")).toThrow("Backend URL");
    expect(() => normalizeBackendUrl("file:///tmp/aisha")).toThrow("Backend URL");
    expect(() => normalizeBackendUrl("https://user:pass@example.test")).toThrow("Backend URL");
    expect(() => normalizeBackendUrl('https://example.test/" onclick="alert(1)')).toThrow("Backend URL");
  });

  it("stores only normalized backend URLs", async () => {
    await setBackendUrl("https://api.example.test/base/", "anon-key");

    expect(mockSecureStore.get("aisha_dirigent_backend_url")).toBe("https://api.example.test/base");
    expect(mockSecureStore.get("aisha_dirigent_anon_key")).toBe("anon-key");
  });

  it("validates custom environments before rebuilding API clients", async () => {
    await expect(
      switchEnvironment("custom", "https://user:pass@example.test", "anon-key"),
    ).rejects.toThrow("Backend URL");

    expect(mockSecureStore.get("aisha_dirigent_backend_url")).toBeUndefined();
  });

  it("does not fetch health checks for invalid backend URLs", async () => {
    await expect(checkBackendHealth("javascript:alert(1)")).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("gateway pinning (dedicated company build)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extra = (Constants as any).expoConfig.extra as Record<string, unknown>;

  beforeEach(() => {
    mockSecureStore.clear();
    jest.clearAllMocks();
  });
  afterEach(() => {
    delete extra.AISHA_GATEWAY_PINNED;
  });

  it("umbrella build (unset) is not pinned and honors the stored override", async () => {
    expect(isGatewayPinned()).toBe(false);
    mockSecureStore.set("aisha_dirigent_backend_url", "https://switched.example.test");
    await expect(getBackendUrl()).resolves.toBe("https://switched.example.test");
  });

  it("pinned build ignores the stored override and returns the baked gateway", async () => {
    extra.AISHA_GATEWAY_PINNED = true;
    expect(isGatewayPinned()).toBe(true);
    // A stored override that a pinned build must refuse to honor.
    mockSecureStore.set("aisha_dirigent_backend_url", "https://attacker.example.test");
    await expect(getBackendUrl()).resolves.toBe("https://api.example.test");
  });
});
