import { renderHook, waitFor } from "@testing-library/react-native";
import { useChatMessages, useConversations } from "@/hooks/useAishaChat";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();
const mockSafeError = jest.fn();
const mockSafeInfo = jest.fn();

jest.mock("@/config/api", () => ({
  api: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
  getBackendUrl: jest.fn(async () => "http://127.0.0.1:57421"),
  realtime: {
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

jest.mock("@/config/oidc", () => ({
  getAccessToken: jest.fn(async () => "valid-token"),
}));

jest.mock("@/lib/security/safeLogger", () => ({
  safeError: (...args: unknown[]) => mockSafeError(...args),
  safeInfo: (...args: unknown[]) => mockSafeInfo(...args),
}));

describe("AISHA chat hooks", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockSafeError.mockReset();
    mockSafeInfo.mockReset();
  });

  it("loads conversations through RPC", async () => {
    // Real get_my_chat_conversations row shape (NO story_id — it is not
    // returned; the schema must still accept the row).
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "550e8400-e29b-41d4-a716-446655440010",
          title: "General",
          status: "active",
          message_count: 1,
          created_at: "2026-04-06T00:00:00.000Z",
          last_message_at: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useConversations("user-1"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledWith("get_my_chat_conversations", {});
  });

  it("loads audited chat messages through RPC", async () => {
    // Real get_chat_messages_audited row shape (NO conversation_id / metadata;
    // it returns routing_category + ai_run_id). The schema must still accept it
    // or parseMessageArray drops every message.
    mockRpc.mockResolvedValue({
      data: [
        {
          id: "550e8400-e29b-41d4-a716-446655440011",
          role: "assistant",
          content: "Hello",
          routing_category: "",
          created_at: "2026-04-06T00:00:00.000Z",
          ai_run_id: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useChatMessages("550e8400-e29b-41d4-a716-446655440010"),
      {
        wrapper: createQueryWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.[0]?.content).toBe("Hello");
    expect(mockRpc).toHaveBeenCalledWith("get_chat_messages_audited", {
      p_conversation_id: "550e8400-e29b-41d4-a716-446655440010",
    });
  });
});
