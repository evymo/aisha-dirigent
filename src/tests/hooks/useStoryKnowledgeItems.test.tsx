/**
 * useStoryKnowledge Hook Tests (Phase 8)
 *
 * @see src/hooks/useStoryKnowledge.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useStoryKnowledgeItems,
  useUpsertStoryKnowledgeItem,
  useDeleteStoryKnowledgeItem,
} from "@/hooks/useStoryKnowledgeItems";
import { _resetLiveTableRegistry } from "@/hooks/useLiveTable";

const hoisted = vi.hoisted(() => {
  const channels = new Map<string, { subscribed: boolean }>();
  function getChannel(name: string) {
    let inst = channels.get(name);
    if (!inst) {
      inst = { subscribed: false };
      channels.set(name, inst);
    }
    const ch = {
      __name: name,
      on: vi.fn(() => ch),
      subscribe: vi.fn(() => {
        inst!.subscribed = true;
        return ch;
      }),
      unsubscribe: vi.fn(() => {
        inst!.subscribed = false;
      }),
    };
    return ch;
  }
  return {
    channels,
    rpcMock: vi.fn(),
    safeErrorMock: vi.fn(),
    channelMock: vi.fn((n: string) => getChannel(n)),
    removeChannelMock: vi.fn((c: { __name: string }) => channels.delete(c.__name)),
  };
});

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...a: unknown[]) => hoisted.rpcMock(...a),
    channel: (n: string) => hoisted.channelMock(n),
    removeChannel: (c: { __name: string }) => hoisted.removeChannelMock(c),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return { ...mod, safeError: (...a: unknown[]) => hoisted.safeErrorMock(...a) };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

const STORY_ID = "11111111-1111-1111-1111-111111111111";
const ITEM_ID = "22222222-2222-2222-2222-222222222222";

const MOCK_ITEM = {
  id: ITEM_ID,
  item_type: "engineering_doc",
  title: "Test KB Item",
  summary: "Summary",
  category: "ux",
  ai_context_tags: ["react", "typescript"],
  status: "active",
  visibility: "public",
  version: 1,
  author_display_name: "Test User",
  is_verified: false,
  quarantine_status: "clear",
  safety_score: null,
  created_at: "2026-05-19T08:00:00Z",
  updated_at: "2026-05-19T08:00:00Z",
};

describe("useStoryKnowledgeItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.channels.clear();
    _resetLiveTableRegistry();
  });
  afterEach(() => {
    _resetLiveTableRegistry();
  });

  it("returns parsed items", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [MOCK_ITEM], error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStoryKnowledgeItems({ storyId: STORY_ID }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].ai_context_tags).toEqual([
      "react",
      "typescript",
    ]);
  });

  it("calls list_story_knowledge_items with story id + archived flag", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    const { Wrapper } = createWrapper();
    renderHook(
      () =>
        useStoryKnowledgeItems({
          storyId: STORY_ID,
          includeArchived: true,
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(hoisted.rpcMock).toHaveBeenCalled());
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "list_story_knowledge_items",
      { p_include_archived: true, p_story_id: STORY_ID },
    );
  });

  it("subscribes to knowledge_items realtime", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    const { Wrapper } = createWrapper();
    renderHook(() => useStoryKnowledgeItems({ storyId: STORY_ID }), {
      wrapper: Wrapper,
    });
    await waitFor(() =>
      expect(hoisted.channelMock).toHaveBeenCalledWith(
        "live::knowledge_items",
      ),
    );
  });

  it("does not call RPC when storyId is null", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: [], error: null });
    const { Wrapper } = createWrapper();
    renderHook(() => useStoryKnowledgeItems({ storyId: null }), {
      wrapper: Wrapper,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(hoisted.rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors", async () => {
    const err = { message: "Access denied", code: "42501" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: err });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStoryKnowledgeItems({ storyId: STORY_ID }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hoisted.safeErrorMock).toHaveBeenCalled();
  });
});

describe("useUpsertStoryKnowledgeItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLiveTableRegistry();
  });

  it("calls upsert RPC with all fields for create", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: ITEM_ID, error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpsertStoryKnowledgeItem(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        storyId: STORY_ID,
        title: "New Item",
        bodyMarkdown: "## Body",
        itemType: "playbook",
        category: "ux",
        tags: ["react", "tags"],
        visibility: "public",
      });
    });
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "upsert_story_knowledge_item_audited",
      expect.objectContaining({
        p_story_id: STORY_ID,
        p_id: undefined,
        p_title: "New Item",
        p_body_markdown: "## Body",
        p_item_type: "playbook",
        p_category: "ux",
        p_ai_context_tags: ["react", "tags"],
        p_visibility: "public",
      }),
    );
  });

  it("passes p_id when editing", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: ITEM_ID, error: null });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpsertStoryKnowledgeItem(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        storyId: STORY_ID,
        id: ITEM_ID,
        title: "Edited",
        tags: ["updated"],
      });
    });
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "upsert_story_knowledge_item_audited",
      expect.objectContaining({
        p_id: ITEM_ID,
        p_title: "Edited",
        p_ai_context_tags: ["updated"],
      }),
    );
  });

  it("invalidates the story_knowledge_items cache on success", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: ITEM_ID, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpsertStoryKnowledgeItem(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        storyId: STORY_ID,
        title: "x",
        bodyMarkdown: "y",
      });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["story_knowledge_items"] });
  });

  it("surfaces RPC errors", async () => {
    const err = { message: "Admin required", code: "42501" };
    hoisted.rpcMock.mockResolvedValue({ data: null, error: err });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpsertStoryKnowledgeItem(), {
      wrapper: Wrapper,
    });
    await expect(
      result.current.mutateAsync({ storyId: STORY_ID, title: "x" }),
    ).rejects.toBeDefined();
    expect(hoisted.safeErrorMock).toHaveBeenCalled();
  });
});

describe("useDeleteStoryKnowledgeItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLiveTableRegistry();
  });

  it("calls delete RPC + invalidates cache", async () => {
    hoisted.rpcMock.mockResolvedValue({ data: true, error: null });
    const { Wrapper, queryClient } = createWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteStoryKnowledgeItem(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ id: ITEM_ID });
    });
    expect(hoisted.rpcMock).toHaveBeenCalledWith(
      "delete_story_knowledge_item_audited",
      { p_id: ITEM_ID, p_reason: undefined },
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ["story_knowledge_items"] });
  });
});
