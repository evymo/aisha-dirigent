/**
 * useAiAgentMetrics Hook Tests
 *
 * Tests for AI observability hooks: agent metrics summary,
 * timeseries, run summary, and materialized view refresh.
 *
 * @see src/hooks/useAiAgentMetrics.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useAiAgentMetrics,
  useAiAgentMetricsTimeseries,
  useAiRunSummary,
  useRefreshAiAgentMetrics,
} from "@/hooks/useAiAgentMetrics";
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

// ---------------------------------------------------------------------------
// Mock data matching Zod schemas
// ---------------------------------------------------------------------------

const MOCK_METRICS_ROW = {
  agent_slug: "orchestrator",
  total_events: 150,
  avg_latency_ms: 320,
  p95_latency_ms: 890,
  total_tokens: 45000,
  total_cost: 0.0234,
  total_errors: 3,
  total_successes: 147,
  error_rate_pct: 2.0,
};

const MOCK_TIMESERIES_ROW = {
  hour: "2026-03-01T10:00:00.000Z",
  agent_slug: "orchestrator",
  total_events: 12,
  avg_latency_ms: 290,
  total_tokens: 3200,
  total_cost: 0.0018,
  errors: 0,
  successes: 12,
};

const MOCK_RUN_SUMMARY = {
  total_runs: 42,
  by_status: { success: 35, failed: 5, running: 2 },
  by_kind: { chat: 20, project_delivery: 15, compliance_check: 7 },
  avg_duration_ms: 2500,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useAiAgentMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useAiAgentMetrics — summary", () => {
    it("fetches agent metrics via RPC with default params", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [MOCK_METRICS_ROW], error: null });

      const { result } = renderHook(() => useAiAgentMetrics({}), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_ai_agent_metrics", {
        p_hours_back: 168,
        p_agent_slug: undefined,
      });
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].agent_slug).toBe("orchestrator");
      expect(result.current.data?.[0].error_rate_pct).toBe(2.0);
    });

    it("passes custom hoursBack and agentSlug", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      renderHook(
        () => useAiAgentMetrics({ hoursBack: 24, agentSlug: "coder" }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("get_ai_agent_metrics", {
          p_hours_back: 24,
          p_agent_slug: "coder",
        });
      });
    });

    it("handles RPC error gracefully", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied", code: "42501" },
      });

      const { result } = renderHook(() => useAiAgentMetrics({}), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(hoisted.safeErrorMock).toHaveBeenCalled();
    });

    it("returns empty array when data is null", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => useAiAgentMetrics({}), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });
  });

  describe("useAiAgentMetricsTimeseries — hourly data", () => {
    it("fetches timeseries data via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: [MOCK_TIMESERIES_ROW],
        error: null,
      });

      const { result } = renderHook(
        () => useAiAgentMetricsTimeseries({ hoursBack: 48 }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith(
        "get_ai_agent_metrics_timeseries",
        { p_hours_back: 48, p_agent_slug: undefined },
      );
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].hour).toBe("2026-03-01T10:00:00.000Z");
    });

    it("handles empty timeseries", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: [], error: null });

      const { result } = renderHook(
        () => useAiAgentMetricsTimeseries({}),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });
  });

  describe("useAiRunSummary — run statistics", () => {
    it("fetches run summary via RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: MOCK_RUN_SUMMARY,
        error: null,
      });

      const { result } = renderHook(() => useAiRunSummary({ hoursBack: 24 }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith("get_ai_run_summary", {
        p_hours_back: 24,
      });
      expect(result.current.data?.total_runs).toBe(42);
      expect(result.current.data?.by_status["success"]).toBe(35);
      expect(result.current.data?.avg_duration_ms).toBe(2500);
    });

    it("defaults to 168 hours", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: MOCK_RUN_SUMMARY,
        error: null,
      });

      renderHook(() => useAiRunSummary({}), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(hoisted.rpcMock).toHaveBeenCalledWith("get_ai_run_summary", {
          p_hours_back: 168,
        });
      });
    });

    it("handles RPC error gracefully", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "connection error" },
      });

      const { result } = renderHook(() => useAiRunSummary({}), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(hoisted.safeErrorMock).toHaveBeenCalled();
    });
  });

  describe("useRefreshAiAgentMetrics — mutation", () => {
    it("calls refresh_ai_agent_metrics RPC", async () => {
      hoisted.rpcMock.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => useRefreshAiAgentMetrics(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(hoisted.rpcMock).toHaveBeenCalledWith("refresh_ai_agent_metrics");
    });

    it("handles refresh error", async () => {
      hoisted.rpcMock.mockResolvedValue({
        data: null,
        error: { message: "refresh failed" },
      });

      const { result } = renderHook(() => useRefreshAiAgentMetrics(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(hoisted.safeErrorMock).toHaveBeenCalled();
    });
  });
});
