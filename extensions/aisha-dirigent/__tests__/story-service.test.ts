/**
 * Tests for story-service.ts — story listing, entries, create, post.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config
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
}));

vi.mock("../src/config", () => ({
  getDirigentConfig: (...args: unknown[]) => mockGetDirigentConfig(...args),
}));

// Mock auth — must include silentRefresh/logout for authenticated-fetch.ts
const mockSilentRefresh = vi.fn().mockResolvedValue(true);
const mockLogout = vi.fn();
const mockGetAuthState = vi.fn(() => ({
  isAuthenticated: true,
  accessToken: "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.dGVzdA",
  refreshToken: null,
  userId: "user-123",
  email: "test@example.com",
}));

vi.mock("../src/auth", () => ({
  getAuthState: (...args: unknown[]) => mockGetAuthState(...args),
  silentRefresh: (...args: unknown[]) => mockSilentRefresh(...args),
  logout: (...args: unknown[]) => mockLogout(...args),
}));

// Mock resource tracker
vi.mock("../src/resource-tracker", () => ({
  recordApiCall: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import once — functions are stateless
import {
  listStories,
  listEntries,
  createStory,
  postEntry,
  getStoryContext,
} from "../src/story-service";

describe("story-service.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    // Restore default auth state (JWT with far-future exp)
    mockGetAuthState.mockReturnValue({
      isAuthenticated: true,
      accessToken: "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.dGVzdA",
      refreshToken: null,
      userId: "user-123",
      email: "test@example.com",
    });
  });

  describe("listStories", () => {
    it("fetches stories from RPC endpoint", async () => {
      const mockStories = [
        { id: "s1", title: "Project Alpha", status: "active", priority: "normal", labels: [] },
        { id: "s2", title: "Project Beta", status: "inbox", priority: "high", labels: [] },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStories,
      });

      const result = await listStories();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:57421/rest/v1/rpc/get_my_stories_audited");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({ p_limit: 50 });
      expect(result).toEqual(mockStories);
    });

    it("returns empty array on fetch error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

      const result = await listStories();
      expect(result).toEqual([]);
    });

    it("returns empty array when not authenticated", async () => {
      mockGetAuthState.mockReturnValue({
        isAuthenticated: false,
        accessToken: null,
        refreshToken: null,
        userId: null,
        email: null,
      });

      const result = await listStories();
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("passes filter parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await listStories({ status: "active", search: "alpha", limit: 10, offset: 5 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({
        p_limit: 10,
        p_status: "active",
        p_search: "alpha",
        p_offset: 5,
      });
    });
  });

  describe("listEntries", () => {
    it("fetches entries via RPC", async () => {
      const mockEntries = [
        { id: "e1", story_id: "s1", entry_type: "note", content: "First entry", created_at: "2026-04-01T12:00:00Z" },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEntries,
      });

      const result = await listEntries("s1");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:57421/rest/v1/rpc/get_story_entries_audited");
      expect(JSON.parse(opts.body)).toEqual({
        p_limit: 50,
        p_offset: 0,
        p_story_id: "s1",
      });
      expect(result).toEqual(mockEntries);
    });

    it("returns empty array on error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });

      const result = await listEntries("s1");
      expect(result).toEqual([]);
    });
  });

  describe("createStory", () => {
    it("creates a story via RPC and reloads detail", async () => {
      const created = { id: "s-new", title: "New Project", status: "inbox" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => "s-new",
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [created],
      });

      const result = await createStory({ title: "New Project", summary: "A test project" });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:57421/rest/v1/rpc/create_project_story_audited");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body).toEqual({
        p_title: "New Project",
        p_summary: "A test project",
        p_goals: [],
        p_constraints: [],
      });
      expect(result).toEqual(created);
    });

    it("preserves the study workflow for study stories", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => "study-story" });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ id: "study-story" }] });
      await createStory({ title: "Study case", study_id: "study-1" });
      expect(mockFetch.mock.calls[0][0]).toMatch(/\/create_story_audited$/);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        p_title: "Study case", p_study_id: "study-1", p_user_id: "user-123",
      });
    });

    it("returns null on backend error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });

      const result = await createStory({ title: "Fail Project" });
      expect(result).toBeNull();
    });
  });

  describe("postEntry", () => {
    it("posts an entry to story thread", async () => {
      const posted = { id: "e-new", story_id: "s1", entry_type: "note", content: "Update" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => "e-new",
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [posted],
      });

      const result = await postEntry({ story_id: "s1", content: "Update" });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:57421/rest/v1/rpc/create_story_entry_audited");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.p_story_id).toBe("s1");
      expect(body.p_content).toBe("Update");
      expect(body.p_entry_type).toBe("note");
      expect(result).toEqual(posted);
    });

    it("supports custom entry type and parent_id", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "e2" }],
      });

      await postEntry({
        story_id: "s1",
        content: "Decision made",
        entry_type: "decision",
        parent_id: "e1",
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.p_entry_type).toBe("decision");
      expect(body.p_parent_id).toBe("e1");
    });
  });

  describe("getStoryContext", () => {
    it("fetches context from RPC", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rules_preview: [
            { id: "r1", title: "Rule 1", category: "quality" },
            { id: "r2", title: "Rule 2", category: "security" },
          ],
        }),
      });

      const result = await getStoryContext("s1");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:57421/rest/v1/rpc/mcp_get_story_context");
      const body = JSON.parse(opts.body);
      expect(body.p_story_id).toBe("s1");
      expect(result?.rules).toEqual(["[quality] Rule 1", "[security] Rule 2"]);
      expect(result?.knowledge_items).toHaveLength(0);
    });

    it("returns null on fetch failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

      const result = await getStoryContext("s1");
      expect(result).toBeNull();
    });
  });

  // ── Auth failure matrix ─────────────────────

  describe("auth failure matrix", () => {
    it("listStories returns [] on 401 (token expired)", async () => {
      // First call returns 401 structured error, second call (retry) also fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error_code: "token_expired", message: "expired" }),
        headers: new Map([["content-type", "application/json"]]),
      });
      // authenticatedFetch will attempt silentRefresh → retry
      mockSilentRefresh.mockResolvedValueOnce(false);

      const result = await listStories();
      expect(result).toEqual([]);
    });

    it("listStories returns [] on 403 (forbidden)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error_code: "forbidden", message: "no access" }),
        headers: new Map([["content-type", "application/json"]]),
      });

      const result = await listStories();
      expect(result).toEqual([]);
    });

    it("listStories returns [] on 429 (rate limited)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error_code: "rate_limited", message: "slow down" }),
        headers: new Map([["content-type", "application/json"]]),
      });

      const result = await listStories();
      expect(result).toEqual([]);
    });

    it("listStories returns [] on 500 (server error)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error_code: "server_error", message: "internal" }),
        headers: new Map([["content-type", "application/json"]]),
      });

      const result = await listStories();
      expect(result).toEqual([]);
    });

    it("createStory returns null on 401", async () => {
      mockSilentRefresh.mockResolvedValueOnce(false);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error_code: "token_expired", message: "expired" }),
        headers: new Map([["content-type", "application/json"]]),
      });

      const result = await createStory({ title: "Test" });
      expect(result).toBeNull();
    });

    it("postEntry returns null on 403", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error_code: "forbidden", message: "no access" }),
        headers: new Map([["content-type", "application/json"]]),
      });

      const result = await postEntry({
        story_id: "s1",
        content: "Test",
        entry_type: "note",
      });
      expect(result).toBeNull();
    });

    it("all functions return empty/null when API is not ready", async () => {
      mockGetAuthState.mockReturnValue({
        isAuthenticated: false,
        accessToken: null,
        refreshToken: null,
        userId: null,
        email: null,
      });

      expect(await listStories()).toEqual([]);
      expect(await listEntries("s1")).toEqual([]);
      expect(await createStory({ title: "X" })).toBeNull();
      expect(await postEntry({ story_id: "s1", content: "X", entry_type: "note" })).toBeNull();
      expect(await getStoryContext("s1")).toBeNull();

      // No fetch calls should have been made
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
