/**
 * Unit tests for useStoryFaithfulnessTrend + helpers (Phase 12 WP 1.5).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { type ReactNode } from "react";

import {
  useStoryFaithfulnessTrend,
  computeTrendStats,
  faithfulnessTierFor,
  type FaithfulnessPoint,
} from "@/hooks/useStoryFaithfulnessTrend";

// Mock the aisha client BEFORE importing the hook
vi.mock("@/integrations/db/client", () => ({
  aisha: {
    rpc: vi.fn(),
  },
}));

// Mock useSession — pretend we have a logged-in user
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ user: { id: "user-1" } }),
}));

import { aisha } from "@/integrations/db/client";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("faithfulnessTierFor", () => {
  it("returns 'high' for >= 0.85", () => {
    expect(faithfulnessTierFor(0.85)).toBe("high");
    expect(faithfulnessTierFor(0.99)).toBe("high");
  });

  it("returns 'medium' for 0.6 - 0.84", () => {
    expect(faithfulnessTierFor(0.6)).toBe("medium");
    expect(faithfulnessTierFor(0.84)).toBe("medium");
  });

  it("returns 'low' for < 0.6", () => {
    expect(faithfulnessTierFor(0.59)).toBe("low");
    expect(faithfulnessTierFor(0)).toBe("low");
  });

  it("returns 'noData' for null/undefined", () => {
    expect(faithfulnessTierFor(null)).toBe("noData");
    expect(faithfulnessTierFor(undefined)).toBe("noData");
  });
});

describe("computeTrendStats", () => {
  it("returns null on empty input", () => {
    expect(computeTrendStats([])).toBeNull();
  });

  it("returns null when all faithfulness values are null", () => {
    const points: FaithfulnessPoint[] = [
      {
        run_id: "11111111-2222-3333-4444-555555555555",
        faithfulness: null,
        agent_slug: "x",
        kind: "chat",
        started_at: "2026-05-20T10:00:00Z",
        finished_at: null,
      },
    ];
    expect(computeTrendStats(points)).toBeNull();
  });

  it("computes avg / latest / tier counts correctly", () => {
    const make = (score: number, ts: string): FaithfulnessPoint => ({
      run_id: "11111111-2222-3333-4444-555555555555",
      faithfulness: score,
      agent_slug: "agent",
      kind: "chat",
      started_at: ts,
      finished_at: null,
    });
    // Order is DESC (newest first) — same as RPC returns
    const points: FaithfulnessPoint[] = [
      make(0.9, "2026-05-20T13:00:00Z"), // high (latest)
      make(0.7, "2026-05-20T12:00:00Z"), // medium
      make(0.5, "2026-05-20T11:00:00Z"), // low
      make(0.95, "2026-05-20T10:00:00Z"), // high
    ];
    const stats = computeTrendStats(points);
    expect(stats).not.toBeNull();
    expect(stats?.count).toBe(4);
    expect(stats?.latest).toBe(0.9);
    expect(stats?.avg).toBeCloseTo((0.9 + 0.7 + 0.5 + 0.95) / 4, 5);
    expect(stats?.high).toBe(2);
    expect(stats?.medium).toBe(1);
    expect(stats?.low).toBe(1);
  });

  it("ignores null-scored points in aggregation", () => {
    const make = (
      score: number | null,
      ts: string,
    ): FaithfulnessPoint => ({
      run_id: "11111111-2222-3333-4444-555555555555",
      faithfulness: score,
      agent_slug: "agent",
      kind: "chat",
      started_at: ts,
      finished_at: null,
    });
    const points: FaithfulnessPoint[] = [
      make(0.9, "2026-05-20T12:00:00Z"),
      make(null, "2026-05-20T11:00:00Z"),
      make(0.8, "2026-05-20T10:00:00Z"),
    ];
    const stats = computeTrendStats(points);
    expect(stats?.count).toBe(2);
    expect(stats?.avg).toBeCloseTo(0.85, 5);
  });
});

describe("useStoryFaithfulnessTrend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT call rpc when storyId is null/undefined (enabled=false)", async () => {
    const { result } = renderHook(
      () => useStoryFaithfulnessTrend({ storyId: null }),
      { wrapper },
    );
    // When enabled:false, React Query stays in idle state (isPending=true,
    // never fires the queryFn). We assert the side effect: aisha.rpc
    // never called.
    await waitFor(() => {
      expect(aisha.rpc).not.toHaveBeenCalled();
    });
    expect(result.current.isFetching).toBe(false);
  });

  it("calls fn_list_story_faithfulness_trend with story id + limit", async () => {
    vi.mocked(aisha.rpc).mockResolvedValueOnce({
      data: [
        {
          run_id: "11111111-2222-3333-4444-555555555555",
          faithfulness: 0.9,
          agent_slug: "agent",
          kind: "chat",
          started_at: "2026-05-20T12:00:00Z",
          finished_at: "2026-05-20T12:00:05Z",
        },
      ],
      error: null,
    });

    const { result } = renderHook(
      () =>
        useStoryFaithfulnessTrend({
          storyId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          limit: 10,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(aisha.rpc).toHaveBeenCalledWith(
      "fn_list_story_faithfulness_trend",
      {
        p_story_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        p_limit: 10,
      },
    );
    expect(result.current.data?.length).toBe(1);
    expect(result.current.data?.[0].faithfulness).toBe(0.9);
  });

  it("filters out shape-invalid rows via Zod safeParse", async () => {
    vi.mocked(aisha.rpc).mockResolvedValueOnce({
      data: [
        // valid
        {
          run_id: "11111111-2222-3333-4444-555555555555",
          faithfulness: 0.9,
          agent_slug: "agent",
          kind: "chat",
          started_at: "2026-05-20T12:00:00Z",
          finished_at: null,
        },
        // invalid — faithfulness out of range
        {
          run_id: "11111111-2222-3333-4444-555555555556",
          faithfulness: 1.5,
          agent_slug: "agent",
          kind: "chat",
          started_at: "2026-05-20T11:00:00Z",
          finished_at: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(
      () =>
        useStoryFaithfulnessTrend({
          storyId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // safeParse on the whole array — if ANY row fails, the whole thing
    // becomes [] (we don't partially accept malformed lists).
    expect(result.current.data).toEqual([]);
  });

  it("propagates RPC error", async () => {
    vi.mocked(aisha.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: "Forbidden" },
    });

    const { result } = renderHook(
      () =>
        useStoryFaithfulnessTrend({
          storyId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("Forbidden");
  });
});
