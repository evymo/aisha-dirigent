import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { invokeEdgeFunction } from "@/integrations/api/edge";
import { useConsultationCall } from "@/hooks/useConsultationCall";

// ── Hoisted mocks ──────────────────────────────────────────────

const { mockRpc, mockChannel, mockRemoveChannel } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockChannel: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn(),
  })),
  mockRemoveChannel: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    session: { user: { id: "test-user-id" } },
  }),
}));

vi.mock("@/integrations/api/edge", () => ({
  invokeEdgeFunction: vi.fn(),
}));

// Mock the LiveKit SDK at the boundary — this unit test verifies call-state
// lifecycle, not real WebRTC media, so we never load the heavy browser SDK.
// The fake is EventEmitter-backed: connect() fires the 'connected' lifecycle
// event, so the hook's RoomEvent.Connected → status:"connected" transition is
// actually exercised (a bare no-op mock would leave that wiring untested).
vi.mock("livekit-client", () => {
  class Room {
    private handlers: Record<string, Array<() => void>> = {};
    on(event: string, cb: () => void) {
      (this.handlers[event] ||= []).push(cb);
      return this;
    }
    private emit(event: string) {
      (this.handlers[event] || []).forEach((cb) => cb());
    }
    connect() {
      this.emit("connected");
      return Promise.resolve();
    }
    disconnect() {
      this.emit("disconnected");
      return Promise.resolve();
    }
    localParticipant = {
      setMicrophoneEnabled: () => Promise.resolve(),
      setCameraEnabled: () => Promise.resolve(),
    };
  }
  return {
    Room,
    RoomEvent: { Connected: "connected", Disconnected: "disconnected" },
  };
});

// ── Wrapper ────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("useConsultationCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should initialize with idle state", () => {
    const { result } = renderHook(() => useConsultationCall(), {
      wrapper: createWrapper(),
    });

    expect(result.current.callState.status).toBe("idle");
    expect(result.current.callState.roomName).toBeNull();
    expect(result.current.callState.token).toBeNull();
    expect(result.current.callState.duration).toBe(0);
  });

  it("should expose startCall and endCall mutations", () => {
    const { result } = renderHook(() => useConsultationCall(), {
      wrapper: createWrapper(),
    });

    expect(result.current.startCall).toBeDefined();
    expect(typeof result.current.startCall.mutateAsync).toBe("function");
    expect(result.current.endCall).toBeDefined();
    expect(typeof result.current.endCall.mutateAsync).toBe("function");
  });

  it("answerCall joins a real Room and flips to 'connected' only on the Room 'connected' event", async () => {
    vi.stubEnv("VITE_LIVEKIT_URL", "wss://livekit.test");
    // update_consultation_status → no error; token fetch resolves a JWT.
    mockRpc.mockResolvedValue({ error: null });
    vi.mocked(invokeEdgeFunction).mockResolvedValue({
      token: "tok",
      identity: "id",
      name: "nm",
      roomName: "room-1",
    });

    const { result } = renderHook(() => useConsultationCall(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.answerCall.mutate({ roomName: "room-1", sessionId: "sess-1" });
    });

    // The mock Room emits 'connected' from connect(), so the hook must land on
    // "connected" (not the synchronous fake-connect the M4 gate forbids).
    await waitFor(() => expect(result.current.callState.status).toBe("connected"));
    expect(result.current.callState.roomName).toBe("room-1");
    expect(result.current.isInCall).toBe(true);
  });
});
