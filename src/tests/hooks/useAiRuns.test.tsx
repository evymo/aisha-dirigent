/**
 * useAiRuns Hook Tests
 *
 * Tests for AI runs monitoring: paginated list and trace events.
 *
 * @see src/hooks/useAiRuns.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAiRuns, useAiRunEvents } from "@/hooks/useAiRuns";
import type { ReactNode } from "react";

const hoisted = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return { ...mod, safeError: (...args: unknown[]) => hoisted.safeErrorMock(...args) };
});

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: { id: "test-user-id" }, isLoading: false }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: (p: string) => p === "view_admin_dashboard",
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const MOCK_RUN = {
  id: "a0a0a0a0-0000-0000-0000-000000000001",
  kind: "route_task",
  status: "success",
  story_id: null,
  actor_user_id: null,
  route_plan: null,
  cost_total_json: {},
  metadata: {},
  started_at: "2026-03-01T10:00:00.000Z",
  finished_at: "2026-03-01T10:00:02.500Z",
};

const MOCK_EVENT = {
  id: "b0b0b0b0-0000-0000-0000-000000000001",
  run_id: MOCK_RUN.id,
  event_type: "llm_call",
  operation: "route_task",
  agent_slug: "orchestrator",
  provider: "openai",
  status: "success",
  duration_ms: 1200,
  cost_json: null,
  request_summary: null,
  response_summary: null,
  error_json: null,
  created_at: "2026-03-01T10:00:01.000Z",
};

describe("useAiRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useAiRuns - list", () => {
    it("fetches AI runs via RPC with default params", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [MOCK_RUN], error: null });

      const { result } = renderHook(() => useAiRuns({}), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_ai_runs_admin", {
        p_status: undefined,
        p_limit: 50,
        p_offset: 0,
      });
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].status).toBe("success");
    });

    it("passes status filter correctly", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      renderHook(() => useAiRuns({ status: "error", limit: 10, offset: 5 }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("get_ai_runs_admin", {
          p_status: "error",
          p_limit: 10,
          p_offset: 5,
        });
      });
    });

    it("handles RPC error gracefully", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied", code: "42501" },
      });

      const { result } = renderHook(() => useAiRuns({}), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(hoisted.safeErrorMock).toHaveBeenCalled();
    });
  });

  describe("useAiRunEvents - trace events", () => {
    it("fetches trace events for a run", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [MOCK_EVENT], error: null });

      const { result } = renderHook(() => useAiRunEvents(MOCK_RUN.id), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_ai_trace_events_admin", {
        p_run_id: MOCK_RUN.id,
      });
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].event_type).toBe("llm_call");
    });

    it("is disabled when no runId provided", () => {
      const { result } = renderHook(() => useAiRunEvents(undefined), {
        wrapper: createWrapper(),
      });

      expect(result.current.isFetching).toBe(false);
    });
  });
});
