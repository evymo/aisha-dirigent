/**
 * useHippocampusSignals + reveal + governance Hook Tests (Phase 6)
 *
 * @see src/hooks/useHippocampusSignals.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useHippocampusSignals,
  useRevealHippocampusContent,
  useSetMemoryGovernance,
} from "@/hooks/useHippocampusSignals";
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
    channelMock: vi.fn((n: string) => getChannel(n)),
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

const STORY_ID = "11111111-1111-1111-1111-111111111111";
const MEM_ID = "22222222-2222-2222-2222-222222222222";

const MOCK_SIGNAL = {
  memory_id: MEM_ID,
  agent_slug: "hippocampus:personality",
  memory_type: "personality",
  importance: 7,
  content_preview: "User prefers terse answers [email] and direct tone",
  preview_truncated: true,
  expires_at: null,
  source_run_id: "33333333-3333-3333-3333-333333333333",
  created_at: "2026-05-19T08:00:00Z",
  updated_at: "2026-05-19T08:00:00Z",
};

const MOCK_REVEAL = {
  memory_id: MEM_ID,
  agent_slug: "hippocampus:personality",
  memory_type: "personality",
  content: "Full unmasked content with user@example.com",
  importance: 7,
  expires_at: null,
  created_at: "2026-05-19T08:00:00Z",
};

describe("useHippocampusSignals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.channels.clear();
    _resetLiveTableRegistry();
  });
  afterEach(() => {
    _resetLiveTableRegistry();
  });

  it("returns parsed PII-scrubbed signals", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [MOCK_SIGNAL], error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useHippocampusSignals({ storyId: STORY_ID }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].content_preview).toContain("[email]");
    expect(result.current.data?.[0].preview_truncated).toBe(true);
  });

  it("subscribes to agent_memories realtime", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    const { Wrapper } = createWrapper();
    renderHook(() => useHippocampusSignals({ storyId: STORY_ID }), {
      wrapper: Wrapper,
    });
    await waitFor(() =>
      expect(hoisted.channelMock).toHaveBeenCalledWith("live::agent_memories"),
    );
  });

  it("calls list_hippocampus_signals with both params", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    const { Wrapper } = createWrapper();
    renderHook(
      () =>
        useHippocampusSignals({
          storyId: STORY_ID,
          agentSlug: "hippocampus:personality",
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith("list_hippocampus_signals", {
      p_story_id: STORY_ID,
      p_agent_slug: "hippocampus:personality",
    });
  });
});

describe("useRevealHippocampusContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLiveTableRegistry();
  });

  it("returns full content on reveal", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [MOCK_REVEAL], error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRevealHippocampusContent(), {
      wrapper: Wrapper,
    });
    const data = await act(async () => result.current.mutateAsync({
      memoryId: MEM_ID,
      reason: "debug",
    }));
    expect(data?.content).toBe("Full unmasked content with user@example.com");
  });

  it("calls reveal RPC with memory_id + reason", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [MOCK_REVEAL], error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRevealHippocampusContent(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ memoryId: MEM_ID, reason: "debug" });
    });
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "reveal_hippocampus_content_audited",
      { p_memory_id: MEM_ID, p_reason: "debug" },
    );
  });

  it("surfaces permission errors", async () => {
    const err = { message: "Admin or staff required", code: "42501" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: err });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRevealHippocampusContent(), {
      wrapper: Wrapper,
    });
    await expect(
      result.current.mutateAsync({ memoryId: MEM_ID }),
    ).rejects.toBeDefined();
    expect(hoisted.safeErrorMock).toHaveBeenCalled();
  });
});

describe("useSetMemoryGovernance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLiveTableRegistry();
  });

  it.each(["promote", "forget", "suspend"] as const)(
    "calls governance RPC with mode=%s",
    async (mode) => {
      hoisted.rpcMock.mockResolvedValue({ data: MEM_ID, error: null });
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useSetMemoryGovernance(), {
        wrapper: Wrapper,
      });
      await act(async () => {
        await result.current.mutateAsync({ memoryId: MEM_ID, mode });
      });
      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "set_memory_governance_audited",
        { p_memory_id: MEM_ID, p_mode: mode, p_reason: undefined },
      );
    },
  );

  it("invalidates hippocampus_signals cache on success", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: MEM_ID, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSetMemoryGovernance(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ memoryId: MEM_ID, mode: "promote" });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hippocampus_signals"] });
  });
});
