import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useSlaTracking } from "@/hooks/useSlaTracking";

// ── Hoisted mocks ──────────────────────────────────────────────

const { mockRpc, mockChannel, mockRemoveChannel, mockMaybeSingle } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockChannel: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn(),
  })),
  mockRemoveChannel: vi.fn(),
  mockMaybeSingle: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
}));

vi.mock("@/integrations/api/edge", () => ({
  invokeEdgeFunction: vi.fn(),
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

describe("useSlaTracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === "get_sla_status") {
        return { maybeSingle: () => Promise.resolve({ data: null, error: null }) };
      }
      // get_sla_dashboard
      return Promise.resolve({ data: [], error: null });
    });
  });

  it("should return null slaStatus when storyId is null", () => {
    const { result } = renderHook(
      () => useSlaTracking(null, "user-123"),
      { wrapper: createWrapper() },
    );

    expect(result.current.slaStatus).toBeUndefined();
    expect(result.current.isWaiting).toBe(false);
    expect(result.current.isBreach).toBe(false);
  });

  it("should fetch and return SLA status when storyId is provided", async () => {
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === "get_sla_status") {
        // The hook reads data?.[0] — get_sla_status resolves to a row array.
        return Promise.resolve({
          data: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              story_id: "11111111-1111-4111-8111-111111111111",
              matrix_room_id: "!room:matrix.org",
              first_message_at: "2026-01-01T00:00:00Z",
              first_response_at: "2026-01-01T00:05:00Z",
              response_time_ms: 300000,
              sla_breached: false,
              escalated_at: null,
              escalated_to: null,
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
          error: null,
        });
      }
      // get_sla_dashboard
      return Promise.resolve({ data: [], error: null });
    });

    const { result } = renderHook(
      () => useSlaTracking("story-123", "user-123"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.slaStatus).toBeDefined());
    expect(result.current.slaStatus?.storyId).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.current.slaStatus?.slaBreached).toBe(false);
    expect(result.current.isWaiting).toBe(false);
  });
});
