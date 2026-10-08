import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useDeleteProviderCredential,
  useProviderCredentials,
  useSetProviderCredential,
} from "@/hooks/useProviderCredentials";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: mockRpc },
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useProviderCredentials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("čte katalog z get_provider_credential_catalog a převede ho na stav bez hodnot", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          env_var: "ANTHROPIC_API_KEY",
          used_by: [{ kind: "provider", slug: "anthropic", display_name: "Anthropic (direct)" }],
          is_set: true,
          updated_at: "2026-10-02T10:00:00Z",
          updated_by: "00000000-0000-0000-0000-000000000001",
          source: "admin",
        },
        { env_var: "OLD_PLUGIN_TOKEN", used_by: [], is_set: false, updated_at: null, updated_by: null, source: null },
      ],
      error: null,
    });
    const { result } = renderHook(() => useProviderCredentials(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_provider_credential_catalog");
    expect(result.current.data).toEqual([
      {
        envVar: "ANTHROPIC_API_KEY",
        usedBy: [{ kind: "provider", slug: "anthropic", displayName: "Anthropic (direct)" }],
        isSet: true,
        updatedAt: "2026-10-02T10:00:00Z",
        updatedBy: "00000000-0000-0000-0000-000000000001",
        source: "admin",
      },
      { envVar: "OLD_PLUGIN_TOKEN", usedBy: [], isSet: false, updatedAt: null, updatedBy: null, source: null },
    ]);
  });

  it("chyba RPC je chyba dotazu (žádný tichý prázdný seznam)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Forbidden: admin or service_role required" } });
    const { result } = renderHook(() => useProviderCredentials(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("nastavení posílá jméno a hodnotu jen jako parametry RPC", async () => {
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });
    const { result } = renderHook(() => useSetProviderCredential(), { wrapper: createWrapper() });
    await act(() => result.current.mutateAsync({ envVar: "OPENAI_API_KEY", value: "SENTINEL-hook" }));
    expect(mockRpc).toHaveBeenCalledWith("set_provider_credential_admin", { p_env_var: "OPENAI_API_KEY", p_value: "SENTINEL-hook" });
  });

  it("chyba nastavení se propaguje", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Pověření X není v katalogu" } });
    const { result } = renderHook(() => useSetProviderCredential(), { wrapper: createWrapper() });
    await expect(result.current.mutateAsync({ envVar: "X_TOKEN", value: "SENTINEL-hook" })).rejects.toThrow(/není v katalogu/);
  });

  it("smazání volá delete_provider_credential_admin", async () => {
    mockRpc.mockResolvedValue({ data: { success: true, deleted: true }, error: null });
    const { result } = renderHook(() => useDeleteProviderCredential(), { wrapper: createWrapper() });
    await act(() => result.current.mutateAsync({ envVar: "OPENAI_API_KEY" }));
    expect(mockRpc).toHaveBeenCalledWith("delete_provider_credential_admin", { p_env_var: "OPENAI_API_KEY" });
  });
});
