/**
 * useAgentKbBindings + useSetAgentKbBinding Hook Tests (Phase 5)
 *
 * @see src/hooks/useAgentKbBindings.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useAgentKbBindings,
  useSetAgentKbBinding,
} from "@/hooks/useAgentKbBindings";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: { rpc: (...a: unknown[]) => hoisted.rpcMock(...a) },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return { ...mod, safeError: (...a: unknown[]) => hoisted.safeErrorMock(...a) };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

const STORY_ID = "11111111-1111-1111-1111-111111111111";
const RULE_ID = "22222222-2222-2222-2222-222222222222";

const MOCK_BINDING = {
  binding_id: "33333333-3333-3333-3333-333333333333",
  agent_slug: "orchestrator",
  knowledge_item_id: RULE_ID,
  knowledge_title: "Test Rule",
  knowledge_slug: "test-rule",
  knowledge_category: "design",
  knowledge_status: "active",
  binding_type: "rule",
  priority: 100,
  version: null,
  is_active: true,
  story_id: STORY_ID,
  is_global: false,
  notes: null,
  created_at: "2026-05-19T08:00:00Z",
  updated_at: "2026-05-19T08:00:00Z",
  created_by: null,
};

describe("useAgentKbBindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed bindings", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [MOCK_BINDING], error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useAgentKbBindings({ storyId: STORY_ID }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].is_global).toBe(false);
  });

  it("calls list_agent_kb_bindings with both params", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    const { Wrapper } = createWrapper();
    renderHook(
      () =>
        useAgentKbBindings({ storyId: STORY_ID, agentSlug: "orchestrator" }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("list_agent_kb_bindings", {
      p_story_id: STORY_ID,
      p_agent_slug: "orchestrator",
    });
  });

  it("does not call RPC when storyId is null", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    const { Wrapper } = createWrapper();
    renderHook(() => useAgentKbBindings({ storyId: null }), { wrapper: Wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors", async () => {
    const err = { message: "Access denied", code: "42501" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: err });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useAgentKbBindings({ storyId: STORY_ID }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "useAgentKbBindings",
      err,
    );
  });
});

describe("useSetAgentKbBinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts a binding with full params", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: "new-id", error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSetAgentKbBinding(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        agentSlug: "orchestrator",
        knowledgeItemId: RULE_ID,
        bindingType: "policy",
        priority: 50,
        isActive: true,
        storyId: STORY_ID,
        notes: "test binding",
      });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "set_agent_knowledge_binding_audited",
      {
        p_agent_slug: "orchestrator",
        p_knowledge_item_id: RULE_ID,
        p_binding_type: "policy",
        p_priority: 50,
        p_version: undefined,
        p_is_active: true,
        p_story_id: STORY_ID,
        p_notes: "test binding",
      },
    );
  });

  it("applies defaults when optional params omitted", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: "id", error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSetAgentKbBinding(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        agentSlug: "orchestrator",
        knowledgeItemId: RULE_ID,
      });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "set_agent_knowledge_binding_audited",
      expect.objectContaining({
        p_binding_type: "rule",
        p_priority: 100,
        p_is_active: true,
      }),
    );
  });

  it("invalidates the agent_kb_bindings cache on success", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: "id", error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSetAgentKbBinding(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        agentSlug: "x",
        knowledgeItemId: RULE_ID,
      });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["agent_kb_bindings"] });
  });

  it("surfaces RPC errors (e.g. permission denied)", async () => {
    const err = { message: "Admin or staff required", code: "42501" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: err });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useSetAgentKbBinding(), {
      wrapper: Wrapper,
    });
    await expect(
      result.current.mutateAsync({
        agentSlug: "x",
        knowledgeItemId: RULE_ID,
      }),
    ).rejects.toBeDefined();
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "useSetAgentKbBinding",
      err,
    );
  });
});
