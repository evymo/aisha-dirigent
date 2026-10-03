import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { useStoryAiConsult } from "@/hooks/useStoryAiConsult";

// ============================================
// Hoisted mocks
// ============================================
const hoisted = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => hoisted.mockRpc(...args),
    functions: {
      invoke: (...args: unknown[]) => hoisted.mockInvoke(...args),
    },
  },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    session: {
      access_token: "test-token",
      user: { id: "11111111-1111-4111-8111-111111111111" },
    },
  }),
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: vi.fn(),
  safeInfo: vi.fn(),
}));

// ============================================
// Helpers
// ============================================
const STORY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MESSAGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeAiConsultResponse(overrides?: Record<string, unknown>) {
  return {
    session_id: SESSION_ID,
    conversation_id: CONVERSATION_ID,
    response: "Odpověď od Aishy",
    action: "chat",
    tokens_used: 150,
    message: {
      id: MESSAGE_ID,
      role: "assistant",
      content: "Odpověď od Aishy",
      routing_category: "story_chat",
      created_at: new Date().toISOString(),
    },
    context_included: {
      user_info: false,
      health_data: true,
      timeline_entries: 5,
    },
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ============================================
// Tests
// ============================================
describe("useStoryAiConsult", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: resolve conversation + empty messages
    hoisted.mockRpc.mockImplementation(async (fn: string) => {
      switch (fn) {
        case "edge_story_ai":
          return {
            data: {
              conversation_id: CONVERSATION_ID,
              created: false,
              story_id: STORY_ID,
              user_id: "11111111-1111-4111-8111-111111111111",
            },
            error: null,
          };
        case "get_chat_messages_audited":
          return { data: [], error: null };
        default:
          return { data: null, error: null };
      }
    });
  });

  // ----------------------------------------
  // Conversation resolution
  // ----------------------------------------
  it("resolves story conversation via edge_story_ai RPC", async () => {
    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    expect(hoisted.mockRpc).toHaveBeenCalledWith(
      "edge_story_ai",
      expect.objectContaining({
        p_action: "get_or_create_story_conversation",
        p_payload: expect.objectContaining({
          story_id: STORY_ID,
        }),
      }),
    );
  });

  it("returns null conversationId when resolution fails", async () => {
    hoisted.mockRpc.mockImplementation(async (fn: string) => {
      if (fn === "edge_story_ai") {
        return { data: null, error: { message: "DB error" } };
      }
      return { data: [], error: null };
    });

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationLoading).toBe(false);
    });

    expect(result.current.conversationId).toBeNull();
  });

  // ----------------------------------------
  // Chat action
  // ----------------------------------------
  it("sends chat message via ai-story-consult edge function", async () => {
    hoisted.mockInvoke.mockResolvedValue({
      data: makeAiConsultResponse(),
      error: null,
    });

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    await act(async () => {
      await result.current.sendChat("Jak se pacient vyvíjí?");
    });

    expect(hoisted.mockInvoke).toHaveBeenCalledWith(
      "ai-story-consult",
      expect.objectContaining({
        body: expect.objectContaining({
          story_id: STORY_ID,
          action: "chat",
          message: "Jak se pacient vyvíjí?",
          include_health_data: true,
          conversation_id: CONVERSATION_ID,
        }),
      }),
    );
  });

  it("forwards language parameter when set", async () => {
    hoisted.mockInvoke.mockResolvedValue({
      data: makeAiConsultResponse(),
      error: null,
    });

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID, language: "en" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    await act(async () => {
      await result.current.sendChat("How is the user doing?");
    });

    expect(hoisted.mockInvoke).toHaveBeenCalledWith(
      "ai-story-consult",
      expect.objectContaining({
        body: expect.objectContaining({
          language: "en",
        }),
      }),
    );
  });

  it("normalizes unsupported locale to english for AI request", async () => {
    hoisted.mockInvoke.mockResolvedValue({
      data: makeAiConsultResponse(),
      error: null,
    });

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID, language: "de-DE" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    await act(async () => {
      await result.current.sendChat("Wie geht es dem Useren?");
    });

    expect(hoisted.mockInvoke).toHaveBeenCalledWith(
      "ai-story-consult",
      expect.objectContaining({
        body: expect.objectContaining({
          language: "en",
        }),
      }),
    );
  });

  it("handles chat error gracefully", async () => {
    hoisted.mockInvoke.mockResolvedValue({
      data: null,
      error: { message: "Edge function failed" },
    });

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    await act(async () => {
      await expect(result.current.sendChat("Test")).rejects.toThrow(
        "Edge function failed",
      );
    });

    // mutateAsync throws to caller; TanStack Query also sets .error after
    // a microtask, but re-throw means the caller handles it directly.
    // Verify the mutation did reject — chatError may or may not be set
    // depending on TanStack Query internals after re-throw.
    expect(hoisted.mockInvoke).toHaveBeenCalled();
  });

  // ----------------------------------------
  // Quick actions
  // ----------------------------------------
  it("generates recap via ai-story-consult", async () => {
    hoisted.mockInvoke.mockResolvedValue({
      data: makeAiConsultResponse({ action: "recap", response: "Rekapitulace případu..." }),
      error: null,
    });

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    await act(async () => {
      await result.current.generateRecap();
    });

    expect(hoisted.mockInvoke).toHaveBeenCalledWith(
      "ai-story-consult",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "recap",
          include_health_data: true,
        }),
      }),
    );
  });

  it("translates entries via ai-story-consult", async () => {
    hoisted.mockInvoke.mockResolvedValue({
      data: makeAiConsultResponse({ action: "translate", response: "Translation..." }),
      error: null,
    });

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    await act(async () => {
      await result.current.translate({ targetLanguage: "en" });
    });

    expect(hoisted.mockInvoke).toHaveBeenCalledWith(
      "ai-story-consult",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "translate",
          target_language: "en",
          include_health_data: false,
        }),
      }),
    );
  });

  it("generates recommendations via ai-story-consult", async () => {
    hoisted.mockInvoke.mockResolvedValue({
      data: makeAiConsultResponse({ action: "recommend", response: "Doporučení..." }),
      error: null,
    });

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    await act(async () => {
      await result.current.generateRecommendations();
    });

    expect(hoisted.mockInvoke).toHaveBeenCalledWith(
      "ai-story-consult",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "recommend",
          include_health_data: true,
        }),
      }),
    );
  });

  it("analyzes health data via ai-story-consult", async () => {
    hoisted.mockInvoke.mockResolvedValue({
      data: makeAiConsultResponse({ action: "analyze", response: "Analýza..." }),
      error: null,
    });

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    await act(async () => {
      await result.current.analyzeTracking();
    });

    expect(hoisted.mockInvoke).toHaveBeenCalledWith(
      "ai-story-consult",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "analyze",
          include_health_data: true,
        }),
      }),
    );
  });

  // ----------------------------------------
  // Loading states
  // ----------------------------------------
  it("exposes correct loading states during chat mutation", async () => {
    let resolveInvoke: ((value: unknown) => void) | undefined;
    hoisted.mockInvoke.mockImplementation(
      () => new Promise((r) => { resolveInvoke = r; }),
    );

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isChatLoading).toBe(false);

    let sendPromise: Promise<unknown> | undefined;
    act(() => {
      sendPromise = result.current.sendChat("Test");
    });

    await waitFor(() => {
      expect(result.current.isChatLoading).toBe(true);
      expect(result.current.isLoading).toBe(true);
    });

    // Resolve the pending invoke
    await act(async () => {
      resolveInvoke?.({ data: makeAiConsultResponse(), error: null });
      await sendPromise;
    });

    await waitFor(() => {
      expect(result.current.isChatLoading).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });
  });

  // ----------------------------------------
  // Messages query
  // ----------------------------------------
  it("fetches thread messages after conversation resolves", async () => {
    const existingMessages = [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        role: "user",
        content: "Předchozí dotaz",
        routing_category: "story_chat",
        created_at: new Date().toISOString(),
      },
      {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        role: "assistant",
        content: "Předchozí odpověď",
        routing_category: "story_chat",
        created_at: new Date().toISOString(),
      },
    ];

    hoisted.mockRpc.mockImplementation(async (fn: string) => {
      switch (fn) {
        case "edge_story_ai":
          return {
            data: {
              conversation_id: CONVERSATION_ID,
              created: false,
              story_id: STORY_ID,
              user_id: "11111111-1111-4111-8111-111111111111",
            },
            error: null,
          };
        case "get_chat_messages_audited":
          return { data: existingMessages, error: null };
        default:
          return { data: null, error: null };
      }
    });

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[1].role).toBe("assistant");
  });

  // ----------------------------------------
  // Optimistic update
  // ----------------------------------------
  it("shows optimistic user message immediately during chat", async () => {
    let resolveInvoke: ((value: unknown) => void) | undefined;
    hoisted.mockInvoke.mockImplementation(
      () => new Promise((r) => { resolveInvoke = r; }),
    );

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    let sendPromise: Promise<unknown> | undefined;
    act(() => {
      sendPromise = result.current.sendChat("Optimistická zpráva").catch(() => { /* expected */ });
    });

    // The optimistic user message should appear instantly
    await waitFor(() => {
      expect(result.current.messages.some((m) => m.content === "Optimistická zpráva")).toBe(true);
    });

    // Resolve the invoke
    await act(async () => {
      resolveInvoke?.({ data: makeAiConsultResponse(), error: null });
      await sendPromise;
    });
  });

  // ----------------------------------------
  // Validation
  // ----------------------------------------
  it("rejects invalid AI response format", async () => {
    hoisted.mockInvoke.mockResolvedValue({
      data: { invalid: "response" },
      error: null,
    });

    const { result } = renderHook(
      () => useStoryAiConsult({ storyId: STORY_ID }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.conversationId).toBe(CONVERSATION_ID);
    });

    await act(async () => {
      await expect(result.current.sendChat("Test")).rejects.toThrow(
        "Invalid AI response format",
      );
    });
  });
});
