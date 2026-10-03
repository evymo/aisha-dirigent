import { renderHook, waitFor, act } from "@testing-library/react-native";
import { useMatrixMessages } from "@/hooks/useMatrixMessages";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockInvoke = jest.fn();
const mockChannel = { on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis() };

jest.mock("@/config/api", () => ({
  api: { rpc: jest.fn(), invoke: (...args: unknown[]) => mockInvoke(...args) },
  realtime: { channel: jest.fn(() => mockChannel), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({ safeError: jest.fn() }));

describe("useMatrixMessages", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("fetches messages via matrix-client-ops get_messages", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        messages: [
          { event_id: "$e1", sender: "@alice:hs", content: { msgtype: "m.text", body: "hi" }, origin_server_ts: 1000, type: "m.room.message" },
        ],
      },
      error: null,
    });

    const { result } = renderHook(() => useMatrixMessages("!room:hs", "u-1"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.messages.length).toBe(1));
    expect(mockInvoke).toHaveBeenCalledWith("matrix-client-ops", {
      body: { action: "get_messages", room_id: "!room:hs", limit: 50 },
    });
    expect(result.current.messages[0].body).toBe("hi");
  });

  it("sends a message via matrix-client-ops send_message", async () => {
    mockInvoke.mockResolvedValue({ data: { messages: [] }, error: null });

    const { result } = renderHook(() => useMatrixMessages("!room:hs", "u-1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });
    await act(async () => {
      await result.current.sendMessage.mutateAsync({ body: "hello" });
    });

    expect(mockInvoke).toHaveBeenCalledWith("matrix-client-ops", {
      body: { action: "send_message", room_id: "!room:hs", content: { msgtype: "m.text", body: "hello" } },
    });
  });
});
