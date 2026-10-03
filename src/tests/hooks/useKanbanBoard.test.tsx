/**
 * useKanbanBoard Hook Tests
 *
 * Covers the kanban board hooks:
 *   - useKanbanBoard — read side, joins kanban_stories_view + useLiveTable
 *   - useMoveStoryStatus — write side, wraps update_story_status_audited
 *
 * @see src/hooks/useKanbanBoard.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useKanbanBoard,
  useMoveStoryStatus,
} from "@/hooks/useKanbanBoard";
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
    const channel = {
      __name: name,
      on: vi.fn(
        (_e: string, _f: unknown, cb: (p: unknown) => void) => {
          inst!.listeners.push(cb);
          return channel;
        },
      ),
      subscribe: vi.fn(() => {
        inst!.subscribed = true;
        return channel;
      }),
      unsubscribe: vi.fn(() => {
        inst!.subscribed = false;
      }),
    };
    return channel;
  }

  return {
    channelInstances,
    rpcMock: vi.fn(),
    safeErrorMock: vi.fn(),
    channelMock: vi.fn((name: string) => getChannel(name)),
    removeChannelMock: vi.fn((ch: { __name: string }) => {
      channelInstances.delete(ch.__name);
    }),
  };
});

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
    channel: (name: string) => hoisted.channelMock(name),
    removeChannel: (ch: { __name: string }) => hoisted.removeChannelMock(ch),
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
  return { Wrapper, queryClient };
}

const STORY_A = {
  story_id: "11111111-1111-1111-1111-111111111111",
  partner_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  user_id: null,
  is_stack_default: false,
  title: "User story A",
  status: "inbox",
  status_label_i18n_key: "storyloop.statuses.inbox",
  status_sort_order: 1,
  status_swimlane_color: "slate",
  status_is_terminal: false,
  priority: "normal",
  is_starred: false,
  last_activity_at: "2026-05-18T12:00:00Z",
  default_branch: "main",
  latest_run_id: null,
  current_agent_slug: null,
  current_run_status: null,
  last_event_at: null,
  // Cost + budget aggregate (kanban_stories_view): cost/tokens COALESCE'd to 0,
  // budget_* NULL when no cap is set for the story.
  cost_to_date: 0,
  tokens_to_date: 0,
  budget_cost_limit: null,
  budget_consumed: null,
  budget_state: null,
};

const STACK_STORY = {
  ...STORY_A,
  story_id: "22222222-2222-2222-2222-222222222222",
  partner_id: null,
  is_stack_default: true,
  title: "Stack default web",
  status: "in_progress",
  status_label_i18n_key: "storyloop.statuses.inProgress",
  status_sort_order: 2,
  status_swimlane_color: "blue",
  // A story with spend + an 80%-consumed budget → budget_state 'approaching'.
  cost_to_date: 12.5,
  tokens_to_date: 4200,
  budget_cost_limit: 20,
  budget_consumed: 16,
  budget_state: "approaching",
};

describe("useKanbanBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.channelInstances.clear();
    _resetLiveTableRegistry();
  });

  afterEach(() => {
    _resetLiveTableRegistry();
    hoisted.channelInstances.clear();
  });

  it("returns parsed kanban rows", async () => {
    hoisted.rpcMock.mockResolvedValue({
      data: [STORY_A, STACK_STORY],
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useKanbanBoard(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].is_stack_default).toBe(false);
    expect(result.current.data?.[1].is_stack_default).toBe(true);
    // Cost + budget fields parse (numeric coercion; NULL budget when no cap).
    expect(result.current.data?.[0].cost_to_date).toBe(0);
    expect(result.current.data?.[0].budget_state).toBeNull();
    expect(result.current.data?.[1].cost_to_date).toBe(12.5);
    expect(result.current.data?.[1].budget_state).toBe("approaching");
  });

  it("calls kanban_stories_view with p_partner_id=null by default", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { Wrapper } = createWrapper();
    renderHook(() => useKanbanBoard(), { wrapper: Wrapper });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("kanban_stories_view", {
      p_partner_id: undefined,
    });
  });

  it("passes partner filter through to the RPC", async () => {
    const partnerId = "33333333-3333-3333-3333-333333333333";
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { Wrapper } = createWrapper();
    renderHook(() => useKanbanBoard({ partnerId }), { wrapper: Wrapper });

    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("kanban_stories_view", {
      p_partner_id: partnerId,
    });
  });

  it("subscribes to the partner_stories realtime channel", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

    const { Wrapper } = createWrapper();
    renderHook(() => useKanbanBoard(), { wrapper: Wrapper });

    await waitFor(() =>
      expect(hoisted.channelMock).toHaveBeenCalledWith("live::partner_stories"),
    );
  });

  it("surfaces RPC errors and logs via safeError", async () => {
    const rpcError = { message: "Access denied", code: "42501" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: rpcError });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useKanbanBoard(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "useKanbanBoard",
      rpcError,
    );
  });
});

describe("useMoveStoryStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLiveTableRegistry();
  });

  it("calls update_story_status_audited with the right params", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: true, error: null });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMoveStoryStatus(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        storyId: STORY_A.story_id,
        toStatus: "in_progress",
      });
    });

    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "update_story_status_audited",
      { p_story_id: STORY_A.story_id, p_status: "in_progress" },
    );
  });

  it("surfaces RPC errors (e.g. illegal transition) and logs via safeError", async () => {
    const rpcError = {
      message: "Transition from trash to active is not allowed",
      code: "22023",
    };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: rpcError });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMoveStoryStatus(), {
      wrapper: Wrapper,
    });

    await expect(
      result.current.mutateAsync({
        storyId: STORY_A.story_id,
        toStatus: "active",
      }),
    ).rejects.toBeDefined();

    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "useMoveStoryStatus",
      rpcError,
    );
  });

  it("invalidates kanban_stories + story_detail cache on success", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: true, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useMoveStoryStatus(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        storyId: STORY_A.story_id,
        toStatus: "in_progress",
      });
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["kanban_stories"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["story_detail"] });
  });
});
