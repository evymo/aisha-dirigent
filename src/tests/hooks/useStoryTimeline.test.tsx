/**
 * useStoryTimeline + useStoryBranchDeployRail Hook Tests (Phase 4)
 *
 * @see src/hooks/useStoryTimeline.ts
 * @see src/hooks/useStoryBranchDeployRail.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useStoryTimeline } from "@/hooks/useStoryTimeline";
import { useStoryBranchDeployRail } from "@/hooks/useStoryBranchDeployRail";
import { _resetLiveTableRegistry } from "@/hooks/useLiveTable";

const hoisted = vi.hoisted(() => {
  const channels = new Map<string, { subscribed: boolean }>();
  function getChannel(name: string) {
    let inst = channels.get(name);
    if (!inst) {
      inst = { subscribed: false };
      channels.set(name, inst);
    }
    const ch = {
      __name: name,
      on: vi.fn(() => ch),
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
    channels,
    rpcMock: vi.fn(),
    safeErrorMock: vi.fn(),
    channelMock: vi.fn((name: string) => getChannel(name)),
    removeChannelMock: vi.fn((c: { __name: string }) => channels.delete(c.__name)),
  };
});

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...a: unknown[]) => hoisted.rpcMock(...a),
    channel: (n: string) => hoisted.channelMock(n),
    removeChannel: (c: { __name: string }) => hoisted.removeChannelMock(c),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return { ...mod, safeError: (...a: unknown[]) => hoisted.safeErrorMock(...a) };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const STORY_ID = "11111111-1111-1111-1111-111111111111";
const RUN_ID = "22222222-2222-2222-2222-222222222222";

const MOCK_TIMELINE_ROWS = [
  {
    event_id: "aaaaaaaa-1111-1111-1111-111111111111",
    event_kind: "trace",
    trace_event_type: "patch_applied",
    ts: "2026-05-19T10:00:00Z",
    agent_slug: "orchestrator",
    operation: "apply_patch",
    status: "succeeded",
    duration_ms: 1234,
    cost: 0.001,
    story_id: STORY_ID,
    run_id: RUN_ID,
    app_name: null,
    files_changed: ["src/foo.ts", "src/bar.ts"],
    payload: { provider: "anthropic" },
  },
  {
    event_id: "bbbbbbbb-1111-1111-1111-111111111111",
    event_kind: "rollback",
    trace_event_type: null,
    ts: "2026-05-19T09:00:00Z",
    agent_slug: null,
    operation: "rollback blue→green",
    status: "executed",
    duration_ms: null,
    cost: null,
    story_id: STORY_ID,
    run_id: null,
    app_name: "aisha-stack-default-web",
    files_changed: null,
    payload: { from_slot: "blue", to_slot: "green" },
  },
];

const MOCK_RAIL_ROWS = [
  {
    app_name: "aisha-stack-default-web",
    active_slot: "blue",
    active_image_tag: "v1.2.3",
    inactive_image_tag: "v1.2.2",
    active_health: "healthy",
    last_switch_at: "2026-05-19T08:00:00Z",
    default_branch: "main",
    last_rollback_at: "2026-05-18T10:00:00Z",
    last_rollback_status: "succeeded",
  },
];

describe("useStoryTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.channels.clear();
    _resetLiveTableRegistry();
  });
  afterEach(() => {
    _resetLiveTableRegistry();
  });

  it("returns parsed timeline events sorted by ts desc", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: MOCK_TIMELINE_ROWS, error: null });

    const { result } = renderHook(
      () => useStoryTimeline({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].event_kind).toBe("trace");
    expect(result.current.data?.[0].files_changed).toEqual([
      "src/foo.ts",
      "src/bar.ts",
    ]);
    expect(result.current.data?.[1].event_kind).toBe("rollback");
  });

  it("calls story_timeline with p_story_id + p_limit", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    renderHook(() => useStoryTimeline({ storyId: STORY_ID, limit: 25 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("story_timeline", {
      p_story_id: STORY_ID,
      p_limit: 25,
    });
  });

  it("subscribes to ai_trace_events realtime", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    renderHook(() => useStoryTimeline({ storyId: STORY_ID }), {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(hoisted.channelMock).toHaveBeenCalledWith("live::ai_trace_events"),
    );
  });

  it("does not call RPC when storyId is null", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    renderHook(() => useStoryTimeline({ storyId: null }), {
      wrapper: createWrapper(),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors", async () => {
    const err = { message: "Access denied", code: "42501" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: err });

    const { result } = renderHook(
      () => useStoryTimeline({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith("useStoryTimeline", err);
  });
});

describe("useStoryBranchDeployRail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.channels.clear();
    _resetLiveTableRegistry();
  });
  afterEach(() => {
    _resetLiveTableRegistry();
  });

  it("returns parsed rail rows", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: MOCK_RAIL_ROWS, error: null });

    const { result } = renderHook(
      () => useStoryBranchDeployRail({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].active_slot).toBe("blue");
    expect(result.current.data?.[0].last_rollback_status).toBe("succeeded");
  });

  it("subscribes to coolify_app_slots realtime", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    renderHook(() => useStoryBranchDeployRail({ storyId: STORY_ID }), {
      wrapper: createWrapper(),
    });
    await waitFor(() =>
      expect(hoisted.channelMock).toHaveBeenCalledWith(
        "live::coolify_app_slots",
      ),
    );
  });

  it("calls story_branch_deploy_rail with p_story_id", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    renderHook(() => useStoryBranchDeployRail({ storyId: STORY_ID }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("story_branch_deploy_rail", {
      p_story_id: STORY_ID,
    });
  });
});
