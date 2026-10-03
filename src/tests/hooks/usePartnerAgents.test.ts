import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const hoisted = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  safeError: vi.fn(),
}));

import { useMyAgents, useSubmitAgent, usePublishAgent } from "@/hooks/usePartnerAgents";

/* ── Helpers ──────────────────────────────────────────────────── */

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const MY_AGENT = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "legal-reviewer",
  name: "Legal Reviewer",
  description: "Reviews contracts.",
  kind: "agent",
  trust_tier: "partner",
  status: "submitted",
  capabilities: ["agent.run_as_story"],
  agent_spec: { purpose: "review", version: "1.0.0" },
  author: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

/* ── Tests ────────────────────────────────────────────────────── */

describe("usePartnerAgents", () => {
  beforeEach(() => hoisted.rpcMock.mockReset());

  it("useMyAgents calls get_my_agents (no params) and parses the list", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [MY_AGENT], error: null });

    const { result } = renderHook(() => useMyAgents(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_my_agents");
    expect(result.current.data?.[0]).toMatchObject({ slug: "legal-reviewer", status: "submitted" });
    // agent_spec is hydrated for the edit form
    expect(result.current.data?.[0].agent_spec?.version).toBe("1.0.0");
  });

  it("useSubmitAgent calls submit_plugin with ALPHABETICAL param keys + null artifact", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: {
        plugin_id: "22222222-2222-2222-2222-222222222222",
        version_id: null,
        slug: "legal-reviewer",
        version: "1.0.0",
        kind: "agent",
        status: "submitted",
      },
      error: null,
    });

    const { result } = renderHook(() => useSubmitAgent(), { wrapper: createWrapper() });

    const manifest = { id: "legal-reviewer", version: "1.0.0", kind: "agent" };
    await result.current.mutateAsync({ manifest });

    expect(hoisted.rpcMock).toHaveBeenCalledTimes(1);
    const [fn, params] = hoisted.rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("submit_plugin");
    // The rpc-params-alphabetical gate: keys MUST be in alphabetical order.
    expect(Object.keys(params)).toEqual(["p_artifact_sha256", "p_artifact_url", "p_manifest"]);
    // Declarative agent → no artifact; manifest passed through verbatim.
    // Optional artifact params are omitted as `undefined` (D12 convention).
    expect(params.p_artifact_sha256).toBeUndefined();
    expect(params.p_artifact_url).toBeUndefined();
    expect(params.p_manifest).toBe(manifest);
  });

  it("usePublishAgent calls publish_agent with the plugin id", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: { status: "review", queue_id: "33333333-3333-3333-3333-333333333333", message: "ok" },
      error: null,
    });

    const { result } = renderHook(() => usePublishAgent(), { wrapper: createWrapper() });
    await result.current.mutateAsync("22222222-2222-2222-2222-222222222222");

    expect(hoisted.rpcMock).toHaveBeenCalledWith("publish_agent", {
      p_plugin_id: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("useSubmitAgent surfaces an RPC error", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: null, error: { message: "Unauthorized" } });

    const { result } = renderHook(() => useSubmitAgent(), { wrapper: createWrapper() });
    await expect(result.current.mutateAsync({ manifest: {} })).rejects.toThrow("Unauthorized");
  });
});
