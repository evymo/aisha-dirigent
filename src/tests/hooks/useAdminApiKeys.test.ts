import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useAllApiKeyStatus, useSaveApiKey } from "@/hooks/useAdminApiKeys";
import type { ApiKeyStatus } from "@/hooks/useAdminApiKeys";

// ── Hoisted mocks ──────────────────────────────────────────────

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

// ── Test wrapper with QueryClientProvider ──────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("useAllApiKeyStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should parse RPC response into status map", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          key_name: "openai_api_key",
          is_set: true,
          updated_at: "2026-01-01T00:00:00Z",
          masked_value: "sk-p****gHj8",
        },
        {
          key_name: "stripe_secret_key",
          is_set: false,
          updated_at: null,
          masked_value: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useAllApiKeyStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data;
    expect(data).toBeDefined();

    const openai = data?.openai_api_key;
    expect(openai).toEqual<ApiKeyStatus>({
      key: "openai_api_key",
      isSet: true,
      updatedAt: "2026-01-01T00:00:00Z",
      maskedValue: "sk-p****gHj8",
    });

    const stripe = data?.stripe_secret_key;
    expect(stripe).toEqual<ApiKeyStatus>({
      key: "stripe_secret_key",
      isSet: false,
      updatedAt: null,
      maskedValue: null,
    });

    expect(mockRpc).toHaveBeenCalledWith("get_api_keys_status_admin");
  });

  it("should handle RPC error safely", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Unauthorized: admin role required" },
    });

    const { result } = renderHook(() => useAllApiKeyStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe(
      "Unauthorized: admin role required"
    );
  });

  it("should handle empty response gracefully", async () => {
    mockRpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const { result } = renderHook(() => useAllApiKeyStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({});
  });

  it("should handle null data gracefully", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useAllApiKeyStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // data won't be null because Array.isArray(null) = false → empty map
    expect(result.current.data).toEqual({});
  });

  it("should filter out malformed items (no key_name)", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { key_name: "openai_api_key", is_set: true, masked_value: "sk-****", updated_at: null },
        { invalid: "no key_name field" },
        null,
      ],
      error: null,
    });

    const { result } = renderHook(() => useAllApiKeyStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = Object.keys(result.current.data ?? {});
    expect(keys).toEqual(["openai_api_key"]);
  });
});

describe("useSaveApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call set_api_key_admin RPC with correct params", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, key_name: "openai_api_key" },
      error: null,
    });

    const { result } = renderHook(() => useSaveApiKey(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        keyName: "openai_api_key",
        value: "sk-test-key-123",
      });
    });

    expect(mockRpc).toHaveBeenCalledWith("set_api_key_admin", {
      p_key_name: "openai_api_key",
      p_key_value: "sk-test-key-123",
    });
  });

  it("should throw on RPC error without leaking sensitive data", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Invalid key_name: unknown_key" },
    });

    const { result } = renderHook(() => useSaveApiKey(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          keyName: "unknown_key",
          value: "some_value",
        });
      })
    ).rejects.toThrow("Invalid key_name: unknown_key");
  });

  it("should not leak API key value in error messages", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Database connection refused" },
    });

    const { result } = renderHook(() => useSaveApiKey(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          keyName: "openai_api_key",
          value: "sk-SUPER-SECRET-KEY-DO-NOT-LOG",
        });
      });
    } catch (e) {
      const errorMessage = (e as Error).message;
      // Error must NOT contain the API key value
      expect(errorMessage).not.toContain("sk-SUPER-SECRET-KEY-DO-NOT-LOG");
      expect(errorMessage).toBe("Database connection refused");
    }
  });

  it("should handle all allowed key types", async () => {
    const allowedKeys = [
      "openai_api_key",
      "packeta_api_key",
      "packeta_api_password",
      "packeta_sender_id",
      "stripe_publishable_key",
      "stripe_secret_key",
      "stripe_webhook_secret",
    ];

    for (const keyName of allowedKeys) {
      mockRpc.mockResolvedValue({
        data: { success: true, key_name: keyName },
        error: null,
      });

      const { result } = renderHook(() => useSaveApiKey(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          keyName,
          value: "test_value",
        });
      });

      expect(mockRpc).toHaveBeenCalledWith("set_api_key_admin", {
        p_key_name: keyName,
        p_key_value: "test_value",
      });

      vi.clearAllMocks();
    }
  });
});
