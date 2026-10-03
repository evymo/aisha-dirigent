/**
 * Tests for story-chat-view.ts — Matrix-backed team chat behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDirigentConfig = vi.fn(() => ({
  aishaUrl: "http://127.0.0.1:57421",
  anonKey: "test-anon-key",
  mcpUrl: "",
  n8nTriggerUrl: "",
  storyId: "",
  expertiseLevel: "expert",
  instanceLabel: "",
  activeProfile: "local",
  profiles: {},
  matrixUrl: "http://127.0.0.1:8008",
  matrixServiceUrl: "http://127.0.0.1:8090/token-exchange",
}));

vi.mock("../src/config", () => ({
  getDirigentConfig: (...args: unknown[]) => mockGetDirigentConfig(...args),
}));

const mockGetAuthState = vi.fn(() => ({
  isAuthenticated: true,
  accessToken: "valid-token",
  refreshToken: "refresh-token",
  userId: "user-123",
  email: "test@example.com",
}));

const mockFetchUserStories = vi.fn().mockResolvedValue([
  { id: "story-1", title: "Story One", status: "active" },
  { id: "story-2", title: "Story Two", status: "draft", is_shared: true },
]);

vi.mock("../src/auth", () => ({
  getAuthState: (...args: unknown[]) => mockGetAuthState(...args),
  fetchUserStories: (...args: unknown[]) => mockFetchUserStories(...args),
}));

const mockAuthenticatedFetch = vi.fn();
const mockIsApiReady = vi.fn(() => true);
const mockGetBaseUrl = vi.fn(() => "http://127.0.0.1:57421");

vi.mock("../src/authenticated-fetch", () => ({
  authenticatedFetch: (...args: unknown[]) => mockAuthenticatedFetch(...args),
  isApiReady: (...args: unknown[]) => mockIsApiReady(...args),
  getBaseUrl: (...args: unknown[]) => mockGetBaseUrl(...args),
}));

const matrixCreds = {
  access_token: "matrix-token",
  user_id: "@user:aisha.test",
  home_server: "aisha.test",
};
const mockExchangeMatrixToken = vi.fn(async () => matrixCreds);
const mockCreateMatrixRoom = vi.fn(async () => "!room:aisha.test");
const mockJoinMatrixRoom = vi.fn(async () => true);
const mockGetRoomHistory = vi.fn(async () => [
  {
    event_id: "$event-1",
    sender: "@other:aisha.test",
    origin_server_ts: 1_775_000_000_000,
    content: { msgtype: "m.text", body: "Hello" },
  },
]);
const mockSendMatrixMessage = vi.fn(async () => "$event-2");
const mockStartSyncLoop = vi.fn();
const mockStopSyncLoop = vi.fn();

vi.mock("../src/matrix-client", () => ({
  exchangeMatrixToken: (...args: unknown[]) => mockExchangeMatrixToken(...args),
  createMatrixRoom: (...args: unknown[]) => mockCreateMatrixRoom(...args),
  joinMatrixRoom: (...args: unknown[]) => mockJoinMatrixRoom(...args),
  getRoomHistory: (...args: unknown[]) => mockGetRoomHistory(...args),
  sendMatrixMessage: (...args: unknown[]) => mockSendMatrixMessage(...args),
  startSyncLoop: (...args: unknown[]) => mockStartSyncLoop(...args),
  stopSyncLoop: (...args: unknown[]) => mockStopSyncLoop(...args),
}));

import { StoryChatViewProvider } from "../src/story-chat-view";

function createMockWebviewView() {
  const postedMessages: unknown[] = [];
  const messageHandlers: Array<(msg: unknown) => void> = [];
  const webview = {
    options: {} as Record<string, unknown>,
    html: "",
    postMessage: vi.fn(async (msg: unknown) => {
      postedMessages.push(msg);
    }),
    onDidReceiveMessage: vi.fn((handler: (msg: unknown) => void) => {
      messageHandlers.push(handler);
      return { dispose: () => {} };
    }),
  };

  return {
    webview,
    postedMessages,
    messageHandlers,
    sendMessage(msg: unknown) {
      for (const handler of messageHandlers) handler(msg);
    },
    viewColumn: undefined,
    visible: true,
    onDidDispose: () => ({ dispose: () => {} }),
    onDidChangeVisibility: () => ({ dispose: () => {} }),
    show: vi.fn(),
    title: "Story Chat",
    description: "",
    badge: undefined,
  };
}

function setupProvider(): {
  provider: StoryChatViewProvider;
  view: ReturnType<typeof createMockWebviewView>;
} {
  const provider = new StoryChatViewProvider({ fsPath: "/test" } as never);
  const view = createMockWebviewView();
  provider.resolveWebviewView(
    view as never,
    {} as never,
    { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as never,
  );
  return { provider, view };
}

describe("StoryChatViewProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedFetch.mockReset();
    mockIsApiReady.mockReturnValue(true);
    mockGetAuthState.mockReturnValue({
      isAuthenticated: true,
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      userId: "user-123",
      email: "test@example.com",
    });
    mockFetchUserStories.mockResolvedValue([
      { id: "story-1", title: "Story One", status: "active" },
      { id: "story-2", title: "Story Two", status: "draft", is_shared: true },
    ]);
    mockExchangeMatrixToken.mockResolvedValue(matrixCreds);
    mockCreateMatrixRoom.mockResolvedValue("!room:aisha.test");
    mockJoinMatrixRoom.mockResolvedValue(true);
    mockGetRoomHistory.mockResolvedValue([
      {
        event_id: "$event-1",
        sender: "@other:aisha.test",
        origin_server_ts: 1_775_000_000_000,
        content: { msgtype: "m.text", body: "Hello" },
      },
    ]);
    mockSendMatrixMessage.mockResolvedValue("$event-2");
  });

  it("sets webview options and renders the Matrix chat shell", () => {
    const { view } = setupProvider();
    expect(view.webview.options).toEqual(expect.objectContaining({ enableScripts: true }));
    expect(view.webview.html).toContain("Team Chat");
    expect(view.webview.html).toMatch(/Content-Security-Policy/);
    expect(view.webview.html).toMatch(/nonce-[A-Za-z0-9]{32}/);
  });

  it("initializes story list and Matrix credentials on ready", async () => {
    const { view } = setupProvider();

    view.sendMessage({ type: "ready" });

    await vi.waitFor(() => {
      expect(view.postedMessages).toContainEqual(
        expect.objectContaining({
          type: "init",
          storyId: null,
          authenticated: true,
          email: "test@example.com",
          matrixConfigured: true,
        }),
      );
      expect(view.postedMessages).toContainEqual({ type: "status", status: "connected" });
    });
    expect(mockFetchUserStories).toHaveBeenCalledTimes(1);
    expect(mockExchangeMatrixToken).toHaveBeenCalledWith("http://127.0.0.1:8090/token-exchange", "valid-token");
  });

  it("forwards supported push events to the webview", () => {
    const { provider, view } = setupProvider();

    provider.handlePushEvent({
      type: "alert",
      title: "Test Alert",
      body: "Alert body",
    });

    expect(view.postedMessages).toContainEqual({
      type: "pushEvent",
      title: "Test Alert",
      body: "Alert body",
      eventType: "alert",
    });
  });

  it("selects a story, resolves its Matrix room, joins, and loads history", async () => {
    const { provider, view } = setupProvider();
    mockAuthenticatedFetch.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: "row-1",
          story_id: "story-1",
          matrix_room_id: "!room:aisha.test",
          room_type: "general",
          display_name: "Story One",
          is_active: true,
        },
      ],
      status: 200,
    });

    provider.handleStoryChanged("story-1");

    await vi.waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        "http://127.0.0.1:57421/rest/v1/rpc/get_story_matrix_rooms",
        { body: { p_story_id: "story-1" } },
      );
      expect(mockJoinMatrixRoom).toHaveBeenCalledWith(
        "http://127.0.0.1:8008",
        matrixCreds,
        "!room:aisha.test",
      );
      expect(view.postedMessages).toContainEqual(
        expect.objectContaining({ type: "messages" }),
      );
    });
  });

  it("shows no-room state when selected story has no active Matrix room", async () => {
    const { provider, view } = setupProvider();
    mockAuthenticatedFetch.mockResolvedValueOnce({ ok: true, data: [], status: 200 });

    provider.handleStoryChanged("story-1");

    await vi.waitFor(() => {
      expect(view.postedMessages).toContainEqual({ type: "noRoom" });
    });
  });

  it("creates and registers a Matrix room for the selected story", async () => {
    const { provider, view } = setupProvider();
    (provider as unknown as Record<string, unknown>).chatStoryId = "story-1";
    (provider as unknown as Record<string, unknown>).matrixCreds = matrixCreds;
    mockAuthenticatedFetch.mockResolvedValueOnce({ ok: true, data: { success: true }, status: 200 });

    view.sendMessage({ type: "createRoom" });

    await vi.waitFor(() => {
      expect(mockCreateMatrixRoom).toHaveBeenCalledWith(
        "http://127.0.0.1:8008",
        matrixCreds,
        "Story Chat — story-1",
      );
      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
        "http://127.0.0.1:57421/rest/v1/rpc/create_story_matrix_room",
        {
          body: {
            p_story_id: "story-1",
            p_matrix_room_id: "!room:aisha.test",
            p_room_type: "general",
          },
        },
      );
    });
  });

  it("sends a Matrix message with an optimistic append", async () => {
    const { provider, view } = setupProvider();
    (provider as unknown as Record<string, unknown>).matrixRoomId = "!room:aisha.test";
    (provider as unknown as Record<string, unknown>).matrixCreds = matrixCreds;

    view.sendMessage({ type: "send", text: "Hello Matrix" });

    await vi.waitFor(() => {
      expect(view.postedMessages).toContainEqual(
        expect.objectContaining({ type: "appendMessage" }),
      );
      expect(mockSendMatrixMessage).toHaveBeenCalledWith(
        "http://127.0.0.1:8008",
        matrixCreds,
        "!room:aisha.test",
        "Hello Matrix",
      );
    });
  });

  it("posts empty messages and selectStory when the user clears the story", () => {
    const { view } = setupProvider();

    view.sendMessage({ type: "switchStory", storyId: "" });

    expect(view.postedMessages).toContainEqual({ type: "messages", messages: [] });
    expect(view.postedMessages).toContainEqual({ type: "selectStory", storyId: null });
  });

  it("refreshes story list only when authenticated", async () => {
    const { provider, view } = setupProvider();

    await provider.refreshStoryList();

    expect(view.postedMessages).toContainEqual(
      expect.objectContaining({ type: "stories" }),
    );
    expect(mockFetchUserStories).toHaveBeenCalledTimes(1);

    mockGetAuthState.mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
      refreshToken: null,
      userId: null,
      email: null,
    });

    const before = view.postedMessages.length;
    await provider.refreshStoryList();
    expect(view.postedMessages).toHaveLength(before);
  });
});
