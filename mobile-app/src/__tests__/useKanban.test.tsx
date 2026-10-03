import { renderHook, waitFor, act } from "@testing-library/react-native";
import {
  fetchAllowedTransitions,
  groupIntoColumns,
  useKanbanBoard,
  useMoveStoryStatus,
} from "@/hooks/useKanban";
import { kanbanStorySchema } from "@/types/schemas";
import { createQueryWrapper } from "@/__tests__/testUtils";

const mockRpc = jest.fn();
const mockEnqueueMutation = jest.fn();
const mockIsNetworkConnected = jest.fn();

jest.mock("@/config/api", () => ({
  api: { rpc: (...args: unknown[]) => mockRpc(...args) },
  realtime: { channel: jest.fn(), removeChannel: jest.fn() },
}));

jest.mock("@/lib/security/safeLogger", () => ({
  safeError: jest.fn(),
}));

jest.mock("@/services/offline", () => ({
  enqueueMutation: (...args: unknown[]) => mockEnqueueMutation(...args),
  isNetworkConnected: () => mockIsNetworkConnected(),
}));

/** Build a fully-defaulted KanbanStory from a partial. */
function mk(partial: Record<string, unknown>) {
  return kanbanStorySchema.parse({
    story_id: "00000000-0000-0000-0000-000000000000",
    title: "Story",
    status: "inbox",
    last_activity_at: "2026-01-01T00:00:00Z",
    ...partial,
  });
}

describe("groupIntoColumns", () => {
  it("orders columns by status_sort_order and stories by last_activity desc", () => {
    const rows = [
      mk({ story_id: "11111111-1111-4111-8111-111111111111", status: "done", status_sort_order: 5, last_activity_at: "2026-01-02T00:00:00Z" }),
      mk({ story_id: "22222222-2222-4222-8222-222222222222", status: "inbox", status_sort_order: 1, last_activity_at: "2026-01-01T00:00:00Z" }),
      mk({ story_id: "33333333-3333-4333-8333-333333333333", status: "inbox", status_sort_order: 1, last_activity_at: "2026-01-05T00:00:00Z" }),
    ];

    const cols = groupIntoColumns(rows);

    expect(cols.map((c) => c.status)).toEqual(["inbox", "done"]);
    expect(cols[0].stories).toHaveLength(2);
    // newest first within the inbox column
    expect(cols[0].stories[0].story_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(cols[1].stories).toHaveLength(1);
  });

  it("returns no columns for an empty board", () => {
    expect(groupIntoColumns([])).toEqual([]);
  });
});

describe("useKanbanBoard", () => {
  beforeEach(() => mockRpc.mockReset());

  it("fetches kanban_stories_view and builds swimlanes", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { story_id: "44444444-4444-4444-8444-444444444444", title: "A", status: "in_progress", status_sort_order: 2, last_activity_at: "2026-01-01T00:00:00Z" },
      ],
      error: null,
    });

    const { result } = renderHook(() => useKanbanBoard(), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("kanban_stories_view", {});
    expect(result.current.columns).toHaveLength(1);
    expect(result.current.columns[0].status).toBe("in_progress");
  });
});

describe("fetchAllowedTransitions", () => {
  beforeEach(() => mockRpc.mockReset());

  it("wraps get_allowed_kanban_transitions outside the screen layer", async () => {
    mockRpc.mockResolvedValue({
      data: [{ to_status: "done", requires_role: null }],
      error: null,
    });

    await expect(fetchAllowedTransitions("55555555-5555-5555-5555-555555555555")).resolves.toEqual([
      { to_status: "done", requires_role: null },
    ]);
    expect(mockRpc).toHaveBeenCalledWith("get_allowed_kanban_transitions", {
      p_story_id: "55555555-5555-5555-5555-555555555555",
    });
  });
});

describe("useMoveStoryStatus", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockEnqueueMutation.mockReset();
    mockIsNetworkConnected.mockReset();
    mockIsNetworkConnected.mockResolvedValue(true);
  });

  it("calls update_story_status_audited with status + story id", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const { result } = renderHook(() => useMoveStoryStatus(), { wrapper: createQueryWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ storyId: "55555555-5555-5555-5555-555555555555", toStatus: "done" });
    });

    expect(mockRpc).toHaveBeenCalledWith("update_story_status_audited", {
      p_status: "done",
      p_story_id: "55555555-5555-5555-5555-555555555555",
    });
  });

  it("queues status transitions while offline instead of calling RPC", async () => {
    mockIsNetworkConnected.mockResolvedValue(false);

    const { result } = renderHook(() => useMoveStoryStatus(), { wrapper: createQueryWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ storyId: "55555555-5555-5555-5555-555555555555", toStatus: "done" });
    });

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockEnqueueMutation).toHaveBeenCalledWith(
      expect.stringContaining("transition_status:55555555-5555-5555-5555-555555555555:done:"),
      { storyId: "55555555-5555-5555-5555-555555555555", toStatus: "done" },
      "transition_status",
    );
  });
});
