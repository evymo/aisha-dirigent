/**
 * useStoryLinks Hook Tests
 *
 * Tests for cross-story link management hooks:
 * - useLinkedStories (fetch linked stories)
 * - useStoryGraph (recursive graph traversal)
 * - useCrossStorySummary (sanitized summary)
 * - useCreateStoryLink (mutation)
 * - useAcceptStoryLink (mutation)
 * - useDismissStoryLink (mutation)
 *
 * @see src/hooks/useStoryLinks.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useLinkedStories,
  useStoryGraph,
  useCrossStorySummary,
  useCreateStoryLink,
  useAcceptStoryLink,
  useDismissStoryLink,
  storyLinkKeys,
} from "@/hooks/useStoryLinks";

/* ── Hoisted mocks ────────────────────────────────────────────── */

const mockRpc = vi.hoisted(() => vi.fn());
const mockSafeError = vi.hoisted(() => vi.fn());

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

const STORY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STORY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const STORY_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const LINK_ID = "11111111-1111-1111-1111-111111111111";

const VALID_LINKED_STORIES = [
  {
    link_id: LINK_ID,
    link_type: "related_to",
    link_direction: "bidirectional",
    is_accepted: true,
    confidence_score: 0.85,
    created_by_agent: "dirigent",
    link_created_at: "2026-04-06T10:00:00Z",
    linked_story_id: STORY_B,
    direction: "outgoing",
    linked_story_title: "Payment Integration",
    linked_delivery_status: "in_progress",
    linked_tech_stack: ["typescript", "react"],
    linked_domain: ["payments"],
    linked_participant_count: 3,
  },
];

const VALID_STORY_GRAPH = [
  {
    link_id: LINK_ID,
    link_type: "related_to",
    connected_story_id: STORY_B,
    confidence_score: 0.85,
    depth: 1,
    title: "Payment Integration",
    delivery_status: "in_progress",
    tech_stack: ["typescript", "react"],
    domain: ["payments"],
    participant_count: 3,
  },
  {
    link_id: "22222222-2222-2222-2222-222222222222",
    link_type: "depends_on",
    connected_story_id: STORY_C,
    confidence_score: null,
    depth: 2,
    title: "Auth Service",
    delivery_status: "completed",
    tech_stack: ["typescript"],
    domain: ["auth"],
    participant_count: 2,
  },
];

const VALID_CROSS_SUMMARY = {
  story_id: STORY_B,
  title: "Payment Integration",
  delivery_status: "in_progress",
  tech_stack: ["typescript", "react"],
  domain: ["payments"],
  participant_count: 3,
  recent_entries: [
    {
      entry_type: "status_update",
      summary: "Payment flow refactored to use new gateway",
      created_at: "2026-04-06T09:00:00Z",
    },
  ],
  link_info: {
    link_type: "related_to",
    link_direction: "bidirectional",
    created_at: "2026-04-06T10:00:00Z",
    confidence_score: 0.85,
  },
};

const CREATE_RESPONSE = {
  id: LINK_ID,
  source_story_id: STORY_A,
  target_story_id: STORY_B,
  link_type: "related_to",
  is_accepted: null,
  created: true,
};

const ACCEPT_RESPONSE = {
  id: LINK_ID,
  is_accepted: true,
  updated: true,
};

const DISMISS_RESPONSE = {
  id: LINK_ID,
  is_accepted: false,
  updated: true,
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

describe("storyLinkKeys", () => {
  it("produces correct links key", () => {
    expect(storyLinkKeys.links(STORY_A)).toEqual([
      "story-links",
      "links",
      STORY_A,
    ]);
  });

  it("produces correct graph key", () => {
    expect(storyLinkKeys.graph(STORY_A, 3)).toEqual([
      "story-links",
      "graph",
      STORY_A,
      3,
    ]);
  });

  it("produces correct cross-summary key", () => {
    expect(storyLinkKeys.crossSummary(STORY_A, STORY_B)).toEqual([
      "story-links",
      "cross-summary",
      STORY_A,
      STORY_B,
    ]);
  });
});

/* ── useLinkedStories tests ──────────────────────────────────── */

describe("useLinkedStories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns linked stories on successful RPC call", async () => {
    mockRpc.mockResolvedValue({ data: VALID_LINKED_STORIES, error: null });

    const { result } = renderHook(() => useLinkedStories(STORY_A), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].linked_story_title).toBe("Payment Integration");
    expect(mockRpc).toHaveBeenCalledWith("get_linked_stories", {
      p_story_id: STORY_A,
    });
  });

  it("returns empty array on Zod validation failure", async () => {
    mockRpc.mockResolvedValue({ data: [{ invalid: true }], error: null });

    const { result } = renderHook(() => useLinkedStories(STORY_A), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(mockSafeError).toHaveBeenCalledWith(
      "storyLinks.getLinkedStories.validation",
      expect.anything(),
    );
  });

  it("does not fetch when storyId is undefined", () => {
    const { result } = renderHook(() => useLinkedStories(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "unauthorized" },
    });

    const { result } = renderHook(() => useLinkedStories(STORY_A), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockSafeError).toHaveBeenCalledWith(
      "storyLinks.getLinkedStories",
      expect.anything(),
    );
  });
});

/* ── useStoryGraph tests ─────────────────────────────────────── */

describe("useStoryGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns story graph on successful RPC call", async () => {
    mockRpc.mockResolvedValue({ data: VALID_STORY_GRAPH, error: null });

    const { result } = renderHook(() => useStoryGraph(STORY_A, 2), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].depth).toBe(1);
    expect(result.current.data?.[1].depth).toBe(2);
    expect(mockRpc).toHaveBeenCalledWith("get_story_graph", {
      p_max_depth: 2,
      p_story_id: STORY_A,
    });
  });

  it("returns empty array on Zod validation failure", async () => {
    mockRpc.mockResolvedValue({ data: [{ bad: "data" }], error: null });

    const { result } = renderHook(() => useStoryGraph(STORY_A), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

/* ── useCrossStorySummary tests ───────────────────────────────── */

describe("useCrossStorySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sanitized summary on success", async () => {
    mockRpc.mockResolvedValue({ data: VALID_CROSS_SUMMARY, error: null });

    const { result } = renderHook(
      () => useCrossStorySummary(STORY_A, STORY_B),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.title).toBe("Payment Integration");
    expect(result.current.data?.participant_count).toBe(3);
    expect(result.current.data?.recent_entries).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledWith("get_cross_story_summary", {
      p_requesting_story_id: STORY_A,
      p_target_story_id: STORY_B,
    });
  });

  it("does not fetch when either story ID is missing", () => {
    const { result } = renderHook(
      () => useCrossStorySummary(STORY_A, undefined),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe("idle");
  });
});

/* ── useCreateStoryLink tests ─────────────────────────────────── */

describe("useCreateStoryLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a story link and returns response", async () => {
    mockRpc.mockResolvedValue({ data: CREATE_RESPONSE, error: null });

    const { result } = renderHook(() => useCreateStoryLink(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        sourceStoryId: STORY_A,
        targetStoryId: STORY_B,
        linkType: "related_to",
      });
    });

    await waitFor(() => {
      expect(result.current.data?.created).toBe(true);
      expect(result.current.data?.id).toBe(LINK_ID);
    });
    expect(mockRpc).toHaveBeenCalledWith("create_story_link", {
      p_link_type: "related_to",
      p_metadata: {},
      p_source_story_id: STORY_A,
      p_target_story_id: STORY_B,
    });
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "not a participant" },
    });

    const { result } = renderHook(() => useCreateStoryLink(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          sourceStoryId: STORY_A,
          targetStoryId: STORY_B,
          linkType: "blocks",
        });
      }),
    ).rejects.toThrow("not a participant");
  });
});

/* ── useAcceptStoryLink tests ─────────────────────────────────── */

describe("useAcceptStoryLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a story link", async () => {
    mockRpc.mockResolvedValue({ data: ACCEPT_RESPONSE, error: null });

    const { result } = renderHook(() => useAcceptStoryLink(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ linkId: LINK_ID, storyId: STORY_A });
    });

    await waitFor(() => {
      expect(result.current.data?.is_accepted).toBe(true);
    });
    expect(mockRpc).toHaveBeenCalledWith("accept_story_link", {
      p_link_id: LINK_ID,
    });
  });
});

/* ── useDismissStoryLink tests ────────────────────────────────── */

describe("useDismissStoryLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dismisses a story link", async () => {
    mockRpc.mockResolvedValue({ data: DISMISS_RESPONSE, error: null });

    const { result } = renderHook(() => useDismissStoryLink(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ linkId: LINK_ID, storyId: STORY_A });
    });

    await waitFor(() => {
      expect(result.current.data?.is_accepted).toBe(false);
    });
    expect(mockRpc).toHaveBeenCalledWith("dismiss_story_link", {
      p_link_id: LINK_ID,
    });
  });
});
