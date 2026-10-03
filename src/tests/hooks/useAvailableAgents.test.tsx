import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import React from "react";

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: vi.fn() },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return { ...actual, safeError: vi.fn(), safeInfo: vi.fn(), safeWarn: vi.fn() };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper };
}

const importHook = async () => import("@/hooks/useAvailableAgents");

const AGENT_ROW = {
  plugin_id: "11111111-1111-1111-1111-111111111111",
  slug: "legal-reviewer",
  name: "Legal Reviewer",
  description: "reviews contracts",
  kind: "agent",
  trust_tier: "partner",
  status: "ga",
  capabilities: ["agent.run_as_story"],
  version: null,
};

const mockRpc = aisha.rpc as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockRpc.mockReset();
});

describe("useAvailableAgents", () => {
  it("lists agents via get_available_plugins(kind=agent)", async () => {
    mockRpc.mockResolvedValue({ data: [AGENT_ROW], error: null });
    const { useAvailableAgents } = await importHook();
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useAvailableAgents(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("get_available_plugins", {
      p_kind: "agent",
      p_tenant_id: undefined,
    });
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].slug).toBe("legal-reviewer");
  });

  it("useAvailableAgent selects the matching agent by slug", async () => {
    mockRpc.mockResolvedValue({
      data: [AGENT_ROW, { ...AGENT_ROW, slug: "other", plugin_id: "22222222-2222-2222-2222-222222222222" }],
      error: null,
    });
    const { useAvailableAgent } = await importHook();
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useAvailableAgent("legal-reviewer"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.slug).toBe("legal-reviewer");
  });

  it("surfaces an RPC error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { useAvailableAgents } = await importHook();
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useAvailableAgents(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("boom");
  });
});

describe("useInstallAgent", () => {
  it("calls install_agent_as_story with the consumer's params and returns the story", async () => {
    mockRpc.mockResolvedValue({
      data: {
        story_id: "33333333-3333-3333-3333-333333333333",
        ruleset_id: null,
        plugin_id: "11111111-1111-1111-1111-111111111111",
        slug: "legal-reviewer",
        rule_count: 0,
        kb_count: 2,
      },
      error: null,
    });
    const { useInstallAgent } = await importHook();
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useInstallAgent(), { wrapper: Wrapper });
    const res = await result.current.mutateAsync({
      pluginId: "11111111-1111-1111-1111-111111111111",
      partnerId: "44444444-4444-4444-4444-444444444444",
      title: "My Agent Story",
    });

    expect(mockRpc).toHaveBeenCalledWith("install_agent_as_story", {
      p_partner_id: "44444444-4444-4444-4444-444444444444",
      p_plugin_id: "11111111-1111-1111-1111-111111111111",
      p_title: "My Agent Story",
    });
    expect(res.story_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(res.kb_count).toBe(2);
  });

  it("defaults partnerId/title to null when omitted", async () => {
    mockRpc.mockResolvedValue({
      data: {
        story_id: "33333333-3333-3333-3333-333333333333",
        ruleset_id: null,
        plugin_id: "11111111-1111-1111-1111-111111111111",
        slug: "x",
        rule_count: 0,
        kb_count: 0,
      },
      error: null,
    });
    const { useInstallAgent } = await importHook();
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useInstallAgent(), { wrapper: Wrapper });
    await result.current.mutateAsync({ pluginId: "11111111-1111-1111-1111-111111111111" });

    expect(mockRpc).toHaveBeenCalledWith("install_agent_as_story", {
      p_partner_id: undefined,
      p_plugin_id: "11111111-1111-1111-1111-111111111111",
      p_title: undefined,
    });
  });
});
