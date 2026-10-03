/**
 * Tests for useModelCostSimulation hook.
 *
 * @module tests/hooks/useModelCostSimulation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  aisha: { rpc: mockRpc },
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function W({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "u-1" },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: (p: string) => p === "view_admin_dashboard",
  }),
}));

import { useModelCostSimulation } from "@/hooks/useModelCostSimulation";

const MOCK_RESULTS = [
  {
    model: "gpt-4o-mini",
    tier: "low_risk",
    monthly_calls: 1000,
    avg_tokens_in: 500,
    avg_tokens_out: 200,
    cost_per_call: 0.001,
    monthly_cost: 1.0,
    quality_score: null,
  },
  {
    model: "gpt-4",
    tier: "medium_risk",
    monthly_calls: 1000,
    avg_tokens_in: 500,
    avg_tokens_out: 200,
    cost_per_call: 0.03,
    monthly_cost: 30.0,
    quality_score: 0.92,
  },
];

describe("useModelCostSimulation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls simulate_model_tier_cost with params", async () => {
    mockRpc.mockResolvedValueOnce({ data: MOCK_RESULTS, error: null });

    const { result } = renderHook(
      () => useModelCostSimulation(1000, "chat"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].model).toBe("gpt-4o-mini");
    expect(mockRpc).toHaveBeenCalledWith("simulate_model_tier_cost", {
      p_monthly_call_count: 1000,
      p_task_type: "chat",
    });
  });

  it("is disabled when monthlyCallCount is 0", () => {
    const { result } = renderHook(
      () => useModelCostSimulation(0, "chat"),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("handles RPC error gracefully", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Function failed" },
    });

    const { result } = renderHook(
      () => useModelCostSimulation(500, "project_delivery"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
