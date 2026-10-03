import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { useAiChat } from "@/hooks/useAiChat";

const { mockRpc, mockInvoke, mockChannel, mockRemoveChannel } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockInvoke: vi.fn(),
  mockChannel: vi.fn(),
  mockRemoveChannel: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    session: {
      access_token: "token",
      user: { id: "11111111-1111-4111-8111-111111111111" },
    },
  }),
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/safeLogger")>()),
  safeError: vi.fn(),
  safeInfo: vi.fn(),
}));

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

describe("useAiChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Realtime channel
    const mockChannelObj = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };
    mockChannel.mockReturnValue(mockChannelObj);

    mockRpc.mockImplementation(async (fn: string) => {
      switch (fn) {
        case "get_chat_access_level":
          return {
            data: {
              access_level: "basic",
              can_chat: true,
              block_reason: null,
            },
            error: null,
          };
        case "get_my_chat_conversations":
          return { data: [], error: null };
        case "get_chat_messages_audited":
          return { data: [], error: null };
        default:
          return { data: null, error: null };
      }
    });
  });

  it("keeps user message visible and shows error when ai-chat request fails", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        error: "Invalid AI request. Please try rephrasing your message.",
        code: "AI_BAD_REQUEST",
      },
      error: null,
    });

    const { result } = renderHook(
      () =>
        useAiChat({
          conversationId: "22222222-2222-4222-8222-222222222222",
          language: "cs",
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.canChat).toBe(true);
      expect(result.current.messagesLoading).toBe(false);
    });

    await act(async () => {
      await expect(result.current.sendMessage("Ahoj Aisho")).rejects.toThrow(
        "Invalid AI request. Please try rephrasing your message."
      );
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBe(2);
    });

    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[0].content).toBe("Ahoj Aisho");
    expect(result.current.messages[1].role).toBe("assistant");
    expect(result.current.messages[1].content).toContain("Invalid AI request");
    expect(result.current.sendErrorMessage).toContain("Invalid AI request");

    act(() => {
      result.current.clearSendError();
    });

    await waitFor(() => {
      expect(result.current.sendErrorMessage).toBeNull();
    });
  });

  it("shows backend debug events in chat for admin debug mode", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: {
          json: async () => ({
            error: "Invalid AI request. Please try rephrasing your message.",
            code: "AI_BAD_REQUEST",
            debug: [
              {
                stage: "access.check",
                message: "Chat access granted (premium)",
                level: "info",
                timestamp: "2026-02-17T10:00:00.000Z",
              },
              {
                stage: "ai.final",
                message: "OpenAI rejected request: invalid param",
                level: "error",
                timestamp: "2026-02-17T10:00:01.000Z",
              },
            ],
          }),
        },
      },
    });

    const { result } = renderHook(
      () =>
        useAiChat({
          conversationId: "22222222-2222-4222-8222-222222222222",
          language: "cs",
          debugMode: true,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.canChat).toBe(true);
    });

    await act(async () => {
      await expect(result.current.sendMessage("Co se stalo?")).rejects.toThrow(
        "Invalid AI request. Please try rephrasing your message."
      );
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBe(4);
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      "ai-chat",
      expect.objectContaining({
        body: expect.objectContaining({
          debug: true,
        }),
      })
    );
    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[1].role).toBe("system");
    expect(result.current.messages[1].content).toContain("[INFO] access.check");
    expect(result.current.messages[2].role).toBe("system");
    expect(result.current.messages[2].content).toContain("[ERROR] ai.final");
    expect(result.current.messages[3].role).toBe("assistant");
    expect(result.current.messages[3].content).toContain("Invalid AI request");
  });
});
