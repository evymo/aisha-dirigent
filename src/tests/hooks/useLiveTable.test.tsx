/**
 * useLiveTable Hook Tests
 *
 * Covers the shared realtime + React Query subscription primitive:
 *   - Subscribes on mount, releases on unmount
 *   - Refcount dedup: multiple subscribers to same (table, filter) share
 *     one underlying channel and one removeChannel call on last unmount
 *   - Realtime event invalidates the queryKey (triggers re-fetch)
 *   - Telemetry reflects active channels
 *   - Channel budget warning fires at threshold
 *
 * @see src/hooks/useLiveTable.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useLiveTable,
  getLiveTableTelemetry,
  _resetLiveTableRegistry,
  MAX_LIVE_CHANNELS,
} from "@/hooks/useLiveTable";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  // Each channel instance has its own listener registry.
  const channelInstances = new Map<
    string,
    {
      listeners: Array<(payload: unknown) => void>;
      subscribed: boolean;
    }
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
        (
          _event: string,
          _filter: unknown,
          callback: (payload: unknown) => void,
        ) => {
          inst!.listeners.push(callback);
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
    return { channel, inst };
  }

  return {
    channelInstances,
    getChannel,
    rpcMock: vi.fn(),
    safeErrorMock: vi.fn(),
    channelMock: vi.fn((name: string) => getChannel(name).channel),
    removeChannelMock: vi.fn((ch: { __name: string }) => {
      const inst = channelInstances.get(ch.__name);
      if (inst) inst.subscribed = false;
      channelInstances.delete(ch.__name);
    }),
    fireEvent: (name: string) => {
      const inst = channelInstances.get(name);
      if (!inst) return;
      for (const cb of inst.listeners) cb({ eventType: "INSERT", new: {} });
    },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLiveTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.channelInstances.clear();
    _resetLiveTableRegistry();
  });

  afterEach(() => {
    _resetLiveTableRegistry();
    hoisted.channelInstances.clear();
  });

  it("fetches initial data via rpc and subscribes to the table", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [{ id: 1 }], error: null });
    const fetchFn = vi.fn(async () => [{ id: 1 }]);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useLiveTable({
          table: "ai_runs",
          queryKey: ["ai_runs"],
          rpc: fetchFn,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(hoisted.channelMock).toHaveBeenCalledWith("live::ai_runs");
    expect(getLiveTableTelemetry().activeChannels).toBe(1);
  });

  it("passes filter through to ChangeFilter", async () => {
    const fetchFn = vi.fn(async () => []);

    const { Wrapper } = createWrapper();
    renderHook(
      () =>
        useLiveTable({
          table: "ai_trace_events",
          filter: "run_id=eq.abc",
          queryKey: ["events", "abc"],
          rpc: fetchFn,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(hoisted.channelMock).toHaveBeenCalledWith(
        "live::ai_trace_events::run_id=eq.abc",
      ),
    );

    const channelInst = hoisted.channelInstances.get(
      "live::ai_trace_events::run_id=eq.abc",
    );
    expect(channelInst?.subscribed).toBe(true);
  });

  it("invalidates queryKey on realtime event (triggers re-fetch)", async () => {
    let callCount = 0;
    const fetchFn = vi.fn(async () => {
      callCount += 1;
      return [{ id: callCount }];
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useLiveTable({
          table: "ai_runs",
          queryKey: ["ai_runs"],
          rpc: fetchFn,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Simulate a realtime INSERT event.
    hoisted.fireEvent("live::ai_runs");

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
  });

  it("shares one channel between two subscribers to the same (table, filter)", async () => {
    const fetchA = vi.fn(async () => [{ a: 1 }]);
    const fetchB = vi.fn(async () => [{ b: 2 }]);

    const { Wrapper } = createWrapper();
    const a = renderHook(
      () =>
        useLiveTable({
          table: "ai_runs",
          queryKey: ["ai_runs", "a"],
          rpc: fetchA,
        }),
      { wrapper: Wrapper },
    );
    const b = renderHook(
      () =>
        useLiveTable({
          table: "ai_runs",
          queryKey: ["ai_runs", "b"],
          rpc: fetchB,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    // Both subscribers should resolve to ONE underlying channel.
    expect(getLiveTableTelemetry().activeChannels).toBe(1);
    expect(getLiveTableTelemetry().channels[0]?.subscriberCount).toBe(2);

    // First unmount: channel stays.
    a.unmount();
    expect(getLiveTableTelemetry().activeChannels).toBe(1);
    expect(hoisted.removeChannelMock).not.toHaveBeenCalled();

    // Second unmount: channel is released.
    b.unmount();
    expect(getLiveTableTelemetry().activeChannels).toBe(0);
    expect(hoisted.removeChannelMock).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe when enabled=false", async () => {
    const fetchFn = vi.fn(async () => []);
    const { Wrapper } = createWrapper();

    renderHook(
      () =>
        useLiveTable({
          table: "ai_runs",
          queryKey: ["ai_runs"],
          rpc: fetchFn,
          enabled: false,
        }),
      { wrapper: Wrapper },
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(hoisted.channelMock).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(getLiveTableTelemetry().activeChannels).toBe(0);
  });

  it("warns via safeError when channel budget is exceeded", async () => {
    const { Wrapper } = createWrapper();

    // Saturate the registry up to MAX_LIVE_CHANNELS.
    const hooks: ReturnType<typeof renderHook>[] = [];
    for (let i = 0; i < MAX_LIVE_CHANNELS; i++) {
      hooks.push(
        renderHook(
          () =>
            useLiveTable({
              table: `t_${i}`,
              queryKey: [`t_${i}`],
              rpc: async () => [],
            }),
          { wrapper: Wrapper },
        ),
      );
    }

    await waitFor(() =>
      expect(getLiveTableTelemetry().activeChannels).toBe(MAX_LIVE_CHANNELS),
    );
    expect(hoisted.safeErrorMock).not.toHaveBeenCalled();

    // One more — should trigger the warning.
    renderHook(
      () =>
        useLiveTable({
          table: "t_overflow",
          queryKey: ["t_overflow"],
          rpc: async () => [],
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(hoisted.safeErrorMock).toHaveBeenCalled());
    expect(hoisted.safeErrorMock.mock.calls[0]?.[0]).toBe("useLiveTable");

    // Cleanup
    for (const h of hooks) h.unmount();
  });

  it("telemetry exposes channel state for /admin/diagnostics", async () => {
    const { Wrapper } = createWrapper();

    renderHook(
      () =>
        useLiveTable({
          table: "ai_runs",
          filter: "status=eq.running",
          queryKey: ["ai_runs", "running"],
          rpc: async () => [],
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(getLiveTableTelemetry().activeChannels).toBe(1),
    );

    const telemetry = getLiveTableTelemetry();
    expect(telemetry.maxChannels).toBe(MAX_LIVE_CHANNELS);
    expect(telemetry.channels[0]).toMatchObject({
      table: "ai_runs",
      filter: "status=eq.running",
      subscriberCount: 1,
    });
  });
});
