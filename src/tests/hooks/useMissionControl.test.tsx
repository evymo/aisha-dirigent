/**
 * useMissionControl Hook Tests
 *
 * Coverage focuses on the two hooks with non-trivial logic:
 *   - useLiveAgentRuns — net-new RPC + Zod
 *   - useAuditFeed — RPC overfetch + client-side severity filter
 *
 * The remaining three (useDeployState, useDriftCount, useRollbackBoard)
 * are thin useLiveTable wrappers whose pattern is already covered by the
 * useKanbanBoard suite — extra coverage would be duplicative noise.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useLiveAgentRuns,
  useAuditFeed,
} from "@/hooks/useMissionControl";
import { _resetLiveTableRegistry } from "@/hooks/useLiveTable";

const hoisted = vi.hoisted(() => {
  const channelInstances = new Map<
    string,
    { listeners: Array<(p: unknown) => void>; subscribed: boolean }
  >();

  function getChannel(name: string) {
    let inst = channelInstances.get(name);
    if (!inst) {
      inst = { listeners: [], subscribed: false };
      channelInstances.set(name, inst);
    }
    const ch = {
      __name: name,
      on: vi.fn((_e, _f, cb) => {
        inst!.listeners.push(cb as (p: unknown) => void);
        return ch;
      }),
      subscribe: vi.fn(() => {
        inst!.subscribed = true;
        return ch;
      }),
      unsubscribe: vi.fn(() => {
        inst!.subscribed = false;
      }),
    };
    return ch;
  }

  return {
    channelInstances,
    rpcMock: vi.fn(),
    safeErrorMock: vi.fn(),
    channelMock: vi.fn((name: string) => getChannel(name)),
    removeChannelMock: vi.fn((c: { __name: string }) => {
      channelInstances.delete(c.__name);
    }),
  };
});

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
    channel: (name: string) => hoisted.channelMock(name),
    removeChannel: (c: { __name: string }) => hoisted.removeChannelMock(c),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...mod,
    safeError: (...args: unknown[]) => hoisted.safeErrorMock(...args),
  };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper };
}

const MOCK_AGENT_RUN = {
  run_id: "11111111-1111-1111-1111-111111111111",
  kind: "chat",
  story_id: "22222222-2222-2222-2222-222222222222",
  story_title: "Test story",
  is_stack_default: false,
  status: "running",
  started_at: "2026-05-19T08:00:00Z",
  elapsed_ms: 12_345,
  current_agent_slug: "orchestrator",
  current_step: "compose_context",
  step_count: 4,
  cost_total: 0.0123,
};

const MOCK_AUDIT_ROWS = [
  {
    id: "aaaaaaaa-1111-1111-1111-111111111111",
    user_id: null,
    user_email: null,
    user_role: null,
    action_type: "view",
    entity_type: "story",
    entity_id: "e1",
    area: "admin",
    severity: "info",
    summary: "Routine view",
    details: {},
  },
  {
    id: "aaaaaaaa-2222-2222-2222-222222222222",
    user_id: null,
    user_email: null,
    user_role: null,
    action_type: "error",
    entity_type: "story",
    entity_id: "e2",
    area: "admin",
    severity: "warning",
    summary: "Something happened",
    details: {},
  },
  {
    id: "aaaaaaaa-3333-3333-3333-333333333333",
    user_id: null,
    user_email: null,
    user_role: null,
    action_type: "error",
    entity_type: "story",
    entity_id: "e3",
    area: "admin",
    severity: "error",
    summary: "Operation failed",
    details: {},
  },
];

describe("useLiveAgentRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.channelInstances.clear();
    _resetLiveTableRegistry();
  });

  afterEach(() => {
    _resetLiveTableRegistry();
  });

  it("returns parsed active agent runs", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: [MOCK_AGENT_RUN],
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useLiveAgentRuns(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].current_agent_slug).toBe("orchestrator");
    expect(result.current.data?.[0].current_step).toBe("compose_context");
  });

  it("calls list_active_agent_runs with p_limit", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { Wrapper } = createWrapper();
    renderHook(() => useLiveAgentRuns({ limit: 50 }), { wrapper: Wrapper });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "list_active_agent_runs",
      { p_limit: 50 },
    );
  });

  it("subscribes to ai_runs realtime channel", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { Wrapper } = createWrapper();
    renderHook(() => useLiveAgentRuns(), { wrapper: Wrapper });

    await waitFor(() =>
      expect(hoisted.channelMock).toHaveBeenCalledWith("live::ai_runs"),
    );
  });
});

describe("useAuditFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.channelInstances.clear();
    _resetLiveTableRegistry();
  });

  afterEach(() => {
    _resetLiveTableRegistry();
  });

  it("client-filters out severities below warning", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: MOCK_AUDIT_ROWS,
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditFeed(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Only warning + error pass the filter; info is dropped.
    expect(result.current.data).toHaveLength(2);
    expect(
      result.current.data?.every((r) =>
        ["warning", "error", "critical", "warn"].includes(
          r.severity.toLowerCase(),
        ),
      ),
    ).toBe(true);
  });

  it("overfetches by 5x to compensate for client-side filtering", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { Wrapper } = createWrapper();
    renderHook(() => useAuditFeed({ limit: 10 }), { wrapper: Wrapper });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("get_audit_journal", {
      p_limit: 50,
    });
  });

  it("respects requested limit after client-filter", async () => {
    // Build 30 elevated rows; expect output capped at 10.
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...MOCK_AUDIT_ROWS[2],
      id: `aaaaaaaa-${String(i).padStart(4, "0")}-2222-2222-222222222222`,
    }));
    hoisted.rpcMock.mockResolvedValue({ data: many, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAuditFeed({ limit: 10 }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(10);
  });
});
