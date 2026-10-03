import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useMatrixRooms } from "@/hooks/useMatrixRooms";

// ── Hoisted mocks ──────────────────────────────────────────────

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    session: { user: { id: "test-user-id" } },
  }),
}));

vi.mock("@/hooks/useMatrixClient", () => ({
  matrixKeys: {
    rooms: (userId: string) => ["matrix", "rooms", userId],
  },
}));

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

describe("useMatrixRooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty rooms when RPC returns empty array", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useMatrixRooms("story-123"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rooms).toEqual([]);
  });

  it("should parse valid room data from RPC", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "room-1",
          story_id: "story-123",
          matrix_room_id: "!abc:matrix.org",
          room_type: "general",
          bridge_type: null,
          display_name: "Test Room",
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useMatrixRooms("story-123"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.rooms.length).toBe(1));
    expect(result.current.rooms[0].matrixRoomId).toBe("!abc:matrix.org");
  });
});
