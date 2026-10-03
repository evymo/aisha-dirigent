/**
 * useIntegrationEvents Hook Tests
 *
 * Tests for integration event observability hooks:
 * - useIntegrationEventStats (aggregated stats)
 * - useIntegrationEventsForStory (story timeline)
 * - useStoryAishaMaturity (maturity score)
 *
 * @see src/hooks/useIntegrationEvents.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useIntegrationEventStats,
  useIntegrationEventsForStory,
  useStoryAishaMaturity,
  integrationEventKeys,
} from "@/hooks/useIntegrationEvents";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const mockRpc = vi.hoisted(() => vi.fn());
const mockHasPermission = vi.hoisted(() => vi.fn(() => true));
const mockSafeError = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    permissions: ["view_admin_dashboard"],
    isLoading: false,
    hasPermission: mockHasPermission,
    hasAllPermissions: vi.fn(() => true),
    hasAnyPermission: vi.fn(() => true),
  }),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: mockRpc,
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: mockSafeError,
}));

/* ── Test data ────────────────────────────────────────────────── */

const STORY_ID = "44444444-4444-4444-4444-444444444444";

const VALID_STATS = {
  total_events: 150,
  completed: 140,
  failed: 8,
  exhausted: 2,
  avg_duration_ms: 340,
  p95_duration_ms: 1200,
  error_rate: 0.053,
  retry_rate: 0.02,
  top_errors: [{ error: "timeout", count: 5 }],
  by_event_type: [
    { event_type: "push", count: 80, avg_duration_ms: 200 },
    { event_type: "pull_request.opened", count: 40, avg_duration_ms: 450 },
  ],
};

const VALID_EVENTS = [
  {
    id: "55555555-5555-5555-5555-555555555551",
    event_source: "github_webhook",
    external_id: "gh-delivery-001",
    event_type: "push",
    status: "completed" as const,
    duration_ms: 210,
    attempt: 1,
    routed_to: "/n8n/webhook/push-deploy",
    n8n_execution_id: "exec-001",
    created_at: "2026-04-03T10:00:00Z",
    completed_at: "2026-04-03T10:00:00Z",
  },
  {
    id: "55555555-5555-5555-5555-555555555552",
    event_source: "github_webhook",
    external_id: "gh-delivery-002",
    event_type: "pull_request.opened",
    status: "failed" as const,
    duration_ms: 5000,
    attempt: 2,
    routed_to: "/n8n/webhook/pr-compliance",
    n8n_execution_id: "exec-002",
    created_at: "2026-04-03T11:00:00Z",
    completed_at: "2026-04-03T11:05:00Z",
  },
];

const VALID_MATURITY = {
  story_id: STORY_ID,
  webhook_reliability: 0.98,
  webhook_events_count: 120,
  avg_response_time_ms: 340,
  deployment_success_rate: 0.95,
  deployments_count: 20,
  compliance_pass_rate: 0.87,
  learning_proposals_count: 3,
  maturity_score: 72,
  maturity_level: "intermediate" as const,
  period_days: 30,
};

/* ── Helpers ──────────────────────────────────────────────────── */

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

/* ── Query key factory tests ─────────────────────────────────── */

describe("integrationEventKeys", () => {
  it("produces correct stats key", () => {
    expect(integrationEventKeys.stats(24, "github_webhook")).toEqual([
      "integration-events",
      "stats",
      24,
      "github_webhook",
    ]);
  });

  it("produces correct story key", () => {
    expect(integrationEventKeys.story(STORY_ID)).toEqual([
      "integration-events",
      "story",
      STORY_ID,
    ]);
  });

  it("produces correct maturity key", () => {
    expect(integrationEventKeys.maturity(STORY_ID)).toEqual([
      "integration-events",
      "maturity",
      STORY_ID,
    ]);
  });
});

/* ── useIntegrationEventStats tests ──────────────────────────── */

describe("useIntegrationEventStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("returns stats on successful RPC call", async () => {
    mockRpc.mockResolvedValue({ data: VALID_STATS, error: null });

    const { result } = renderHook(() => useIntegrationEventStats(24), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total_events).toBe(150);
    expect(result.current.data?.error_rate).toBeCloseTo(0.053);
    expect(mockRpc).toHaveBeenCalledWith("get_integration_event_stats", {
      p_event_source: undefined,
      p_hours_back: 24,
    });
  });

  it("passes event_source filter", async () => {
    mockRpc.mockResolvedValue({ data: VALID_STATS, error: null });

    const { result } = renderHook(
      () => useIntegrationEventStats(12, "github_webhook"),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_integration_event_stats", {
      p_event_source: "github_webhook",
      p_hours_back: 12,
    });
  });

  it("does not fetch when permission is missing", async () => {
    mockHasPermission.mockReturnValue(false);

    const { result } = renderHook(() => useIntegrationEventStats(24), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns null on Zod validation failure", async () => {
    mockRpc.mockResolvedValue({ data: { bad: "shape" }, error: null });

    const { result } = renderHook(() => useIntegrationEventStats(24), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(mockSafeError).toHaveBeenCalledWith(
      "integration.stats.validation",
      expect.anything(),
    );
  });

  it("handles RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Stats RPC failed" },
    });

    const { result } = renderHook(() => useIntegrationEventStats(24), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockSafeError).toHaveBeenCalledWith(
      "integration.stats.fetch",
      expect.anything(),
    );
  });
});

/* ── useIntegrationEventsForStory tests ──────────────────────── */

describe("useIntegrationEventsForStory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("returns story events on successful RPC call", async () => {
    mockRpc.mockResolvedValue({ data: VALID_EVENTS, error: null });

    const { result } = renderHook(
      () => useIntegrationEventsForStory(STORY_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].event_type).toBe("push");
    expect(mockRpc).toHaveBeenCalledWith("get_integration_events_for_story", {
      p_limit: 50,
      p_story_id: STORY_ID,
    });
  });

  it("passes custom limit", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    renderHook(() => useIntegrationEventsForStory(STORY_ID, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith("get_integration_events_for_story", {
        p_limit: 10,
        p_story_id: STORY_ID,
      }),
    );
  });

  it("does not fetch when storyId is undefined", async () => {
    const { result } = renderHook(
      () => useIntegrationEventsForStory(undefined),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns empty array on Zod validation failure", async () => {
    mockRpc.mockResolvedValue({
      data: [{ wrong_schema: true }],
      error: null,
    });

    const { result } = renderHook(
      () => useIntegrationEventsForStory(STORY_ID),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(mockSafeError).toHaveBeenCalledWith(
      "integration.storyEvents.validation",
      expect.anything(),
    );
  });
});

/* ── useStoryAishaMaturity tests ─────────────────────────────── */

describe("useStoryAishaMaturity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it("returns maturity score on successful RPC call", async () => {
    mockRpc.mockResolvedValue({ data: VALID_MATURITY, error: null });

    const { result } = renderHook(() => useStoryAishaMaturity(STORY_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.maturity_level).toBe("intermediate");
    expect(result.current.data?.webhook_reliability).toBeCloseTo(0.98);
    expect(mockRpc).toHaveBeenCalledWith("get_story_aisha_maturity", {
      p_story_id: STORY_ID,
    });
  });

  it("does not fetch when storyId is undefined", async () => {
    const { result } = renderHook(() => useStoryAishaMaturity(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns null on Zod validation failure", async () => {
    mockRpc.mockResolvedValue({
      data: { not: "maturity" },
      error: null,
    });

    const { result } = renderHook(() => useStoryAishaMaturity(STORY_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(mockSafeError).toHaveBeenCalledWith(
      "integration.maturity.validation",
      expect.anything(),
    );
  });

  it("handles RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Maturity fetch failed" },
    });

    const { result } = renderHook(() => useStoryAishaMaturity(STORY_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockSafeError).toHaveBeenCalledWith(
      "integration.maturity.fetch",
      expect.anything(),
    );
  });
});
